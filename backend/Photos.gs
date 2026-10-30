/**
 * Ts Menu — recipe photos, stored in a Drive folder and shared view-only by link.
 *
 * The folder "Ts Menu Photos" is created on first upload and remembered in Script
 * Property PHOTO_FOLDER_ID. Set that property yourself to use an existing folder.
 */

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* deleted — make a new one */ }
  }
  const folder = DriveApp.createFolder('Ts Menu Photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/** Saves an image blob and returns a URL an <img> tag can load. */
function savePhotoBlob_(blob, recipeId) {
  const type = String(blob.getContentType() || '');
  if (type.indexOf('image/') !== 0) throw new Error('That file isn\'t an image.');
  const ext = type.split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z]/g, '') || 'jpg';
  blob.setName(recipeId + '-' + Date.now() + '.' + ext);
  const file = photoFolder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    throw new Error('Drive would not share the photo by link. Check that link sharing is allowed for this Google account.');
  }
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600';
}

/** Downloads an imported recipe's photo and keeps our own copy. */
function rehostImage_(url, recipeId) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() >= 400) throw new Error('HTTP ' + res.getResponseCode());
  return savePhotoBlob_(res.getBlob(), recipeId);
}

function trashPhoto_(photoUrl) {
  const m = String(photoUrl || '').match(/[?&]id=([\w-]+)/);
  if (!m) return;
  try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (err) { /* already gone */ }
}
