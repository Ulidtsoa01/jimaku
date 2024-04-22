const editModal = document.getElementById('edit-entry-modal');
const moveModal = document.getElementById('move-entries-modal');
const renameModal = document.getElementById('rename-entries-modal');
const deleteModal = document.getElementById('confirm-delete-modal');

const editButton = document.getElementById('edit-entry');
const deleteFilesButton = document.getElementById('delete-files');
const downloadFilesButton = document.getElementById('download-files');
const moveFilesButton = document.getElementById('move-files');
const renameFilesButton = document.getElementById('rename-files');
const confirmRenameButton = document.getElementById('confirm-rename');

const uploadForm = document.getElementById('upload-form');
const uploadInput = document.getElementById('upload-file-input');

const updateInfo = document.getElementById('update-info');

const dropZone = document.getElementById('file-upload-drop-zone');
let lastDraggedTarget = null;
let currentRenameOption = null;

class RenameOptions {
  constructor() {
    this.search = document.getElementById('rename-search').value;
    this.repl = document.getElementById('rename-replace').value;
    this.isEmpty = this.search.length === 0;
    this.isRegex = document.getElementById('rename-use-regex').checked;
    this.matchAll = document.getElementById('rename-match-all').checked;
    this.caseSensitive = document.getElementById('rename-case-sensitive').checked;
    this.applyTo = document.getElementById('rename-apply').value;
    this.caseTransform = document.getElementById('rename-text-formatting').value;

    let flags = '';
    if(!this.caseSensitive) flags += 'i';
    if(this.matchAll) flags += 'g';

    if(this.isRegex) {
      this.search = new RegExp(this.search, flags);
    } else {
      this.search = new RegExp(escapeRegex(this.search), flags);
    }

    this.files = getSelectedFiles().map(e => e.textContent);
    this.renamed = this.files.map(f => this.rename(f));
  }

  updateTable(tbody) {
    tbody.innerHTML = '';
    for(let i = 0; i < this.files.length; ++i) {
      let original = this.files[i];
      let renamed = this.renamed[i];
      let tr = document.createElement('tr');
      let left = document.createElement('td');
      left.setAttribute('data-th', 'Original');
      left.textContent = original;
      let right = document.createElement('td');
      right.setAttribute('data-th', 'Renamed');
      if(original != renamed) {
        right.textContent = renamed;
        right.classList.add('changed');
      }
      tr.appendChild(left);
      tr.appendChild(right);
      tbody.appendChild(tr);
    }
  }

  toJSON() {
    return this.files.map((e, i) => { return {from: e, to: this.renamed[i]}; }).filter(obj => obj.from !== obj.to);
  }

  replace(s) {
    if(this.isEmpty) return s;
    return this.matchAll ? s.replaceAll(this.search, this.repl).trim() : s.replace(this.search, this.repl).trim();
  }

  transformCase(s) {
    if(this.caseTransform === 'none') {
      return s;
    } else if(this.caseTransform === 'lower') {
      return s.toLowerCase();
    } else {
      return s.toUpperCase();
    }
  }

  rename(filename) {
    if(this.applyTo === 'file') {
      let idx = filename.lastIndexOf('.');
      if(idx !== -1) {
        let changed = this.transformCase(this.replace(filename.substring(0, idx)));
        return changed + filename.substring(idx);
      }
    } else if(this.applyTo === 'ext') {
      let idx = filename.lastIndexOf('.');
      if(idx !== -1) {
        let changed = this.transformCase(this.replace(filename.substring(idx + 1)));
        if(changed.length !== 0) {
          return filename.substring(0, idx) + '.' + changed;
        } else {
          return filename.substring(0, idx);
        }
      }
    }
    return this.transformCase(this.replace(filename));
  }
}

const checkedSelector = '.entry:not(.hidden) > .file-bulk > input[type="checkbox"]';
const query = `
query ($id: Int) {
  Media (id: $id, type: ANIME) {
    id
    title {
      romaji
      english
      native
    }
    isAdult
    format
  }
}`;

const relationQuery = `
query ($id: Int) {
  Media(id: $id) {
    relations {
      edges {
        relationType
        node {
          id
          type
          title {
            romaji
            native
            english
          }
        }
      }
    }
  }
}
`;

const fileExtension = (name) => name.slice((name.lastIndexOf('.') - 1 >>> 0) + 2);
const allowedExtensions = ["srt", "ssa", "ass", "zip", "sub", "sup", "idx"];

function filterValidFileList(files) {
  let filtered = Array.from(files).filter(f => allowedExtensions.includes(fileExtension(f.name)));
  const dt = new DataTransfer();
  filtered.forEach(f => dt.items.add(f));
  return dt.files;
}

function getSelectedFiles() {
  return [...document.querySelectorAll(checkedSelector + ':checked')].map(e => {
    return e.parentElement.parentElement.querySelector('.file-name');
  });
}

function removeCheckedFiles() {
  document.querySelectorAll(checkedSelector + ':checked').forEach(e => {
    let parent = e.parentElement.parentElement;
    return parent.parentElement.removeChild(parent);
  });
  setCheckboxState();
}

const disableButtons = (disabled) => {
  if(moveFilesButton) moveFilesButton.disabled = disabled;
  if(renameFilesButton) renameFilesButton.disabled = disabled;
  downloadFilesButton.disabled = disabled;
}

function showModalAlert(modal, {level, content}) {
  if(modal) {
    let alert = createAlert({level, content});
    let el = modal.querySelector('h1');
    el.parentNode.insertBefore(alert, el.nextSibling);
  } else {
    showAlert({level, content});
  }
}

function modalAlertHook(modal) {
  let el = modal.querySelector('h1');
  return (e) => el.parentNode.insertBefore(e, el.nextSibling);
}

function updateEntryFields(titles, adult, movie) {
  if (titles?.romaji) {
    document.getElementById('entry-name').value = titles.romaji;
  }
  if (titles?.native) {
    document.getElementById('entry-japanese-name').value = titles.native;
  }
  if (titles?.english) {
    document.getElementById('entry-english-name').value = titles.english;
  }
  document.getElementById('entry-movie').checked = movie;
  document.getElementById('entry-adult').checked = adult;
}

async function getAnimeInfo(id) {
  let response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: query,
      variables: { id }
    })
  });
  if (response.ok) {
    let js = await response.json();
    let media = js?.data?.Media;
    if(media) {
      updateEntryFields(media.title, media.isAdult, media.format === 'MOVIE');
    }
    showModalAlert(editModal, {level: 'success', content: `Updated info from AniList`});
  } else {
    showModalAlert(editModal, {level: 'error', content: `AniList returned ${response.status}`})
  }
};

async function refreshTmdbNames(id) {
  let param = encodeURIComponent(`${id.type}:${id.id}`);
  let response = await fetch(`/entry/tmdb?id=${param}`);
  if (response.ok) {
    let js = await response.json();
    if(js) {
      updateEntryFields(js.title, js.adult, js.movie);
    }
    showModalAlert(editModal, {level: 'success', content: `Updated info from TMDB`});
  } else {
    showModalAlert(editModal, {level: 'error', content: `API returned ${response.status}`})
  }
};

async function getAnimeRelationIds(id) {
  let response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: relationQuery,
      variables: { id }
    })
  });
  if (response.ok) {
    let js = await response.json();
    let nodes = js?.data?.Media?.relations?.edges ?? [];
    return nodes.map(e => e.node.id);
  } else {
    console.log(`AniList returned ${response.status}`);
    return [];
  }
}

async function populateAnimeRelations() {
  if (entryData.anilist_id == null) {
    return;
  }
  let ids = await getAnimeRelationIds(entryData.anilist_id);
  if (ids.length === 0) {
    return;
  }

  let response = await fetch('/entry/relations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      anilist_ids: ids
    })
  });
  if (!response.ok) {
    console.log(`Server returned ${response.status} for relations`);
    return;
  }
  let js = await response.json();
  if(js.length === 0) return;
  let div = document.getElementById('relations');
  div.innerHTML = '<span>Related</span>';
  for (const entry of js) {
    let el = document.createElement('a');
    el.href = `/entry/${entry.id}`
    el.textContent = getPreferredNameForEntry(entry);
    el.classList.add('relation');
    el.classList.add('file-name');
    el.setAttribute('data-name', entry.name);
    if (entry.japanese_name !== null) {
      el.setAttribute('data-japanese-name', entry.japanese_name);
    }
    if (entry.english_name !== null) {
      el.setAttribute('data-english-name', entry.english_name);
    }
    div.appendChild(el);
  }
}

async function downloadFiles() {
  let files = getSelectedFiles();
  if (files.length === 0) {
    return;
  }
  if (files.length === 1) {
    files[0].click();
    return;
  }
  files = files.map(e => e.textContent);
  let payload = {files};
  let resp = await fetch(`/entry/${entryId}/bulk`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload)
  });

  if(!resp.ok) {
    let content = `Server responded with status code ${resp.status}`;
    if(resp.headers.get('content-type') === 'application/json') {
      let js = await resp.json();
      content = js.error;
    }
    showAlert({level: 'error', content});
  } else {
    const a = document.createElement('a');
    let blob = await resp.blob();
    a.href = URL.createObjectURL(blob);
    a.download = resp.headers.get("x-jimaku-filename");
    a.classList.add("hidden");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  bulkCheck.click();
}

editButton?.addEventListener('click', () => editModal?.showModal());
updateInfo?.addEventListener('click', async (e) => {
  e.preventDefault();
  let text = document.getElementById('entry-anilist-id').value;
  let id = parseInt(text, 10);
  if(Number.isNaN(id)) {
    id = getAnilistId(text);
  }
  if(id) {
    await getAnimeInfo(id)
  } else {
    let tmdb = getTmdbId(document.getElementById('entry-tmdb-url').value);
    if(tmdb === null) {
      showModalAlert(editModal, {level: 'error', content: 'Missing or invalid AniList ID or TMDB URL'});
    } else {
      await refreshTmdbNames(tmdb);
    }
  }
});

const bulkCheck = document.getElementById('bulk-check');
bulkCheck?.addEventListener('click', () => {
  let indeterminate = bulkCheck.getAttribute('tribool') === 'yes';
  let checked = indeterminate ? false : bulkCheck.checked;
  document.querySelectorAll(checkedSelector).forEach(ch => {
    ch.checked = checked;
  });

  disableButtons(!checked);
  if (indeterminate) {
    bulkCheck.checked = false;
    bulkCheck.indeterminate = false;
    bulkCheck.removeAttribute('tribool');
  }
});

function setCheckboxState() {
  let checkboxes = [...document.querySelectorAll(checkedSelector)];
  let checked = checkboxes.reduce((prev, el) => prev + el.checked, 0);
  let nothingChecked = checked === 0;
  disableButtons(nothingChecked);

  if(nothingChecked) {
    bulkCheck.checked = false;
    bulkCheck.indeterminate = false;
    bulkCheck.removeAttribute('tribool');
  }
  else if(checked === checkboxes.length) {
    bulkCheck.indeterminate = false;
    bulkCheck.removeAttribute('tribool');
    bulkCheck.checked = true;
  } else {
    bulkCheck.indeterminate = true;
    bulkCheck.setAttribute('tribool', 'yes');
    bulkCheck.checked = false;
  }
}

async function deleteFiles() {
  let files = getSelectedFiles().map(e => e.textContent);
  let payload = {files};
  if (files.length === 0) {
    payload.delete_parent = true;
  }
  let js = await callApi(`/entry/${entryId}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload)
  });

  if(js === null) {
    return;
  }

  if(payload.delete_parent) {
    showAlert({level: 'success', content: 'Successfully deleted entry, redirecting you back home...'});
  } else {
    let total = js.success + js.failed;
    showAlert({level: 'success', content: `Successfully deleted ${js.success}/${total} file${total == 1 ? "s" : ""}`});
  }
  deleteModal.close();
  removeCheckedFiles();
  if(payload.delete_parent) {
    await sleep(3000);
    window.location.href = '/';
  }
}

async function moveFiles() {
  let files = getSelectedFiles().map(e => e.textContent);
  if (files.length === 0) {
    return;
  }

  let params = new URLSearchParams();
  let payload = {files};
  let destinationId = parseInt(document.getElementById('move-to-entry-id')?.value, 10);
  if (!Number.isNaN(destinationId)) {
    payload.entry_id = destinationId;
  } else {
    let anilistId = getAnilistId(document.getElementById('anilist-url')?.value);
    if (anilistId !== null) {
      payload.anilist_id = anilistId;
      params.append('anilist_id', anilistId);
    }
    let tmdbId = getTmdbId(document.getElementById('tmdb-url')?.value);
    if (tmdbId !== null) {
      payload.tmdb = `${tmdbId.type}:${tmdbId.id}`;
      payload.anime = false;
      params.append('tmdb_id', payload.tmdb);
    }
    let name = document.getElementById('directory-name').value;
    if(name) {
      payload.name = name;
      params.append('name', name);
    }
    let resp = await fetch('/entry/search?' + params);
    if(resp.ok) {
      let js = await resp.json();
      payload.entry_id = js.entry_id;
    }
  }

  if(Object.keys(payload).length === 1) {
    showModalAlert(moveModal, {level: 'error', content: 'Either a name, AniList URL, or TMDB URL is required'});
    return;
  }

  let js = await callApi(`/entry/${entryId}/move`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload)
  }, modalAlertHook);

  if(js === null) {
    return;
  }

  let total = js.success + js.failed;
  showModalAlert(moveModal, {level: 'success', content: `Successfully moved ${js.success}/${total} files, redirecting to folder in 5 seconds...`});
  await sleep(5000);
  window.location.href = `/entry/${js.entry_id}`;
}

function updateRenameOptions() {
  let search = document.getElementById('rename-search');
  try {
    currentRenameOption = new RenameOptions();
  } catch(e) {
    if (e instanceof SyntaxError) {
      search.setCustomValidity('Invalid regex provided');
    }
    return;
  }
  search.setCustomValidity('');
  currentRenameOption.updateTable(renameModal.querySelector('table#renamed-files > tbody'));
}

function openRenameModal() {
  let form = renameModal.querySelector('form');
  form.reset();
  currentRenameOption = new RenameOptions();
  currentRenameOption.updateTable(renameModal.querySelector('table#renamed-files > tbody'));
  renameModal.showModal();
}

async function renameFiles() {
  if(currentRenameOption === null) {
    return;
  }
  let payload = currentRenameOption.toJSON();
  if(payload.length === 0) {
    return;
  }

  let js = await callApi(`/entry/${entryId}/rename`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload)
  }, modalAlertHook);

  if(js === null) {
    return;
  }

  let total = js.success + js.failed;
  showModalAlert(renameModal, {level: 'success', content: `Successfully renamed ${js.success}/${total} files, refreshing in 3 seconds...`});
  await sleep(3000);
  window.location.reload();
}

populateAnimeRelations();
deleteFilesButton?.addEventListener('click', () => {
  let files = getSelectedFiles();
  let span = deleteModal.querySelector('span');
  span.textContent = files.length === 1 ? '1 file' : files.length === 0 ? `the entire entry` : `${files.length} files`;
  deleteModal.showModal();
});
document.getElementById('confirm-move')?.addEventListener('click', (e) => {
  e.preventDefault();
  moveFiles();
});
document.getElementById('confirm-delete')?.addEventListener('click', (e) => {
  e.preventDefault();
  deleteFiles();
});
moveFilesButton?.addEventListener('click', () => moveModal?.showModal());
moveModal?.querySelector('button[formmethod=dialog]')?.addEventListener('click', (e) => {
  e.preventDefault();
  moveModal.close();
});
document.getElementById('clear-search-filter')?.addEventListener('click', setCheckboxState);
try {
  filterElement.addEventListener('input', setCheckboxState);
}
catch(_) {}

document.querySelectorAll('.file-bulk > input[type="checkbox"]').forEach(ch => {
  ch.addEventListener('click', setCheckboxState);
});

uploadInput?.addEventListener('change', () => {
  uploadForm.submit();
});
downloadFilesButton?.addEventListener('click', downloadFiles);
renameFilesButton?.addEventListener('click', openRenameModal);
renameModal?.querySelector('form')?.addEventListener('input', debounced(updateRenameOptions, 150))
confirmRenameButton?.addEventListener('click', (e) => {
  e.preventDefault();
  renameFiles();
});

if (uploadInput !== null) {
  window.addEventListener('dragenter', (e) => {
    lastDraggedTarget = e.target;
    dropZone.classList.add('dragged');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.target === lastDraggedTarget || e.target == document) {
      dropZone.classList.remove('dragged');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragged');
    let files = filterValidFileList(e.dataTransfer.files);
    if(files.length > 0) {
      uploadInput.files = files;
      uploadForm.submit();
    }
  });
}
