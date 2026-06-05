export const encryptionFlow = [
  'User signs in with account password.',
  'User unlocks vault with master password.',
  'Master password derives a local AES-256 key using a KDF.',
  'Client decrypts vault item keys only after unlock.',
  'Server stores encrypted vault blobs and encrypted item keys only.',
  'Sharing encrypts the item key for each recipient.',
];

export const securityControls = [
  'AES-256-GCM encryption for sensitive credential fields',
  'Client-side encryption/decryption before server sync',
  'Role-based access controls for all admin actions',
  'Permission-scoped sharing: use only, view, edit, manage',
  'Audit logs for credential, user, and sharing events',
  'Ownership transfer required before deleting users',
];
