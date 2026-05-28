function sanitizeLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const accuracy = Number(value.accuracy);
  return {
    latitude: roundCoord(latitude),
    longitude: roundCoord(longitude),
    accuracy: Number.isFinite(accuracy) ? Math.max(0, Math.round(accuracy)) : null,
  };
}

function roundCoord(value) {
  return Math.round(value * 1000) / 1000;
}

function formatLocationContext(location) {
  if (!location) return '';
  const accuracy = location.accuracy ? ` / accuracy about ${location.accuracy}m` : '';
  return `現在地コンテキスト: latitude ${location.latitude}, longitude ${location.longitude}${accuracy}. ユーザーが許可した概略位置です。住所の断定や細かい居場所の推測は禁止。近くの案内が必要な時だけ使ってください。`;
}

module.exports = {
  formatLocationContext,
  sanitizeLocation,
};
