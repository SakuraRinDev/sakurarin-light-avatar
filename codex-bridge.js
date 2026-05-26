const { spawn } = require('child_process');

class CodexAppServerBridge {
  constructor({ cwd }) {
    this.cwd = cwd;
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.threadId = null;
    this.currentTurn = null;
    this.queue = Promise.resolve();
  }

  async ask(message) {
    this.queue = this.queue.then(() => this.askUnsafe(message));
    return this.queue;
  }

  async askUnsafe(message) {
    await this.ensureReady();
    let collected = '';
    this.currentTurn = { collected, done: null };
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.currentTurn = null;
        reject(new Error('codex app-server timeout'));
      }, 90000);
      this.currentTurn.done = (error, text) => {
        clearTimeout(timer);
        this.currentTurn = null;
        if (error) reject(error);
        else resolve(text);
      };
    });

    await this.request('turn/start', {
      threadId: this.threadId,
      input: [
        {
          type: 'text',
          text: [
            `ユーザー入力: ${message}`,
            '返答条件: 字幕としてそのまま表示する短い日本語だけ返す。説明、引用符、箇条書きは禁止。最大60文字。',
          ].join('\n'),
        },
      ],
      approvalPolicy: 'never',
      effort: 'low',
    });

    return done;
  }

  async ensureReady() {
    if (this.child && this.threadId) return;
    this.startChild();
    await this.request('initialize', {
      clientInfo: {
        name: 'sakurarin-light-avatar',
        title: 'SakuraRin Light Avatar',
        version: '0.1.0',
      },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
    const thread = await this.request('thread/start', {
      cwd: this.cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      model: null,
      developerInstructions: [
        'あなたはWebサイト上のAIアバターです。',
        '見た目は人ではなく、明るい背景でふわふわ浮くドジかわいい光の塊です。',
        'コード編集、ファイル操作、コマンド実行、調査は絶対にしません。',
        'ユーザーへの返答は、Web字幕としてそのまま表示できる短い日本語だけにします。',
        '少しおっちょこちょいで、かわいく、でもわざとらしすぎない口調にします。',
      ].join('\n'),
    });
    this.threadId = thread.thread.id;
  }

  startChild() {
    if (this.child) return;
    this.child = spawn(
      'codex',
      ['app-server', '--listen', 'stdio://', '-c', 'suppress_unstable_features_warning=true'],
      {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.child.stderr.on('data', () => {});
    this.child.on('exit', () => {
      this.child = null;
      this.threadId = null;
      for (const { reject } of this.pending.values()) reject(new Error('codex app-server exited'));
      this.pending.clear();
      if (this.currentTurn) this.currentTurn.done(new Error('codex app-server exited'));
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk.toString();
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'codex app-server error'));
      else pending.resolve(message.result);
      return;
    }

    if (!this.currentTurn) return;
    if (message.method === 'item/agentMessage/delta') {
      this.currentTurn.collected = `${this.currentTurn.collected || ''}${message.params.delta || ''}`;
      return;
    }
    if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage') {
      this.currentTurn.collected = message.params.item.text || this.currentTurn.collected || '';
      return;
    }
    if (message.method === 'turn/completed') {
      const text = String(this.currentTurn.collected || '').trim();
      this.currentTurn.done(null, text);
    }
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server request timeout: ${method}`));
      }, 60000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
}

module.exports = { CodexAppServerBridge };
