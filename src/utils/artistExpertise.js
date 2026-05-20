export const EXPERTISE_REQUIRING_ROLE = [
  'Sunderkand',
  'Bhajan sandhya',
  'Bhagwat khatha',
  'Rudrabhishek',
];

export const isRamleelaExpertise = (value) =>
  String(value || '').trim().toLowerCase().includes('ramleela');

export const isOtherServicesExpertise = (value) =>
  String(value || '').trim().toLowerCase() === 'other services';

export const requiresServiceDescription = (expertise) =>
  EXPERTISE_REQUIRING_ROLE.includes(String(expertise || '').trim());
