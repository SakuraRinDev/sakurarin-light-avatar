const { parsePhoneNumberFromString } = require('libphonenumber-js/min');

function normalizeContact(contact) {
  const parsed = parsePhoneNumberFromString(contact.telephone || '', 'JP');
  const tel = String(contact.telephone || '').trim();
  const displayPhone = parsed ? parsed.formatInternational() : tel;
  return {
    id: contact.id,
    name: contact.name,
    phoneticName: contact.phoneticName || '',
    organization: contact.organization || '',
    title: contact.title || '',
    contactType: contact.contactType || 'general',
    telephone: tel,
    displayPhone,
    telHref: `tel:${tel.replace(/[^\d+]/g, '')}`,
    email: contact.email || '',
    url: contact.url || '',
    address: contact.address || '',
    hours: contact.hours || '',
    note: contact.note || '',
    favorite: Boolean(contact.favorite),
    tags: Array.isArray(contact.tags) ? contact.tags : [],
    phoneMeta: {
      valid: parsed ? parsed.isValid() : false,
      possible: parsed ? parsed.isPossible() : false,
      country: parsed?.country || 'JP',
      type: parsed?.getType?.() || 'UNKNOWN',
    },
  };
}

function normalizeContacts(contacts) {
  return contacts.map(normalizeContact);
}

module.exports = {
  normalizeContact,
  normalizeContacts,
};
