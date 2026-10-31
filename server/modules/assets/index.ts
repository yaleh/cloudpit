// Express router mounted at /api/assets by server/index.ts for uploading and
// serving chat attachments stored in the global ~/.cloudcli/assets folder.
export { default as assetsRoutes } from './assets.routes.js';
// findStoredAttachmentAsset: the read side the chat resend path and the Cloudpit runtime
// criterion use to resolve a stored attachment across the dual read roots.
export { findStoredAttachmentAsset } from './services/image-assets.service.js';
