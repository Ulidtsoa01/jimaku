/* This file is licensed under AGPL-3.0 */
const filterElement = document.getElementById('search-files');
const escapedRegex = /[-\/\\^$*+?.()|[\]{}]/g;
const escapeRegex = (e) => e.replace(escapedRegex, '\\$&');
const MIN_SCORE = -1500;

function __score(haystack, query) {
  let result = fuzzysort.single(__normalizeString(query), __normalizeString(haystack));
  return result?.score == null ? MIN_SCORE : result.score;
}

function __normalizeString(s) {
  return s ? s.normalize('NFKD').replace(/[\u0300-\u036f]/g, "") : s;
}

const changeModifiedToRelative = () => {
  document.querySelectorAll('.file-modified').forEach(node => {
    let lastModified = node.parentElement.dataset.lastModified;
    if(/^[0-9]+$/.test(lastModified)) {
      const seconds = parseInt(lastModified, 10);
      node.textContent = formatRelative(seconds);
    } else{
      const date = Date.parse(lastModified);
      node.parentElement.dataset.lastModified = date;
      node.textContent = formatRelative(date / 1000);
    }
  });
}

const changeDisplayNames = (value) => {
  let keys = {'romaji':'data-name', 'native':'data-japanese-name', 'english':'data-english-name'};
  let key = keys[value];
  document.querySelectorAll('.entry > .file-name').forEach(el => {
    let parent = el.parentElement;
    el.textContent = parent.getAttribute(key) ?? parent.dataset.name;
  });

  let el = document.querySelector('.entry-info > .title');
  if (el !== null) {
    // entryData should be defined here
    el.textContent = getPreferredNameForEntry(entryData);
  }

  document.querySelectorAll('.relation.file-name').forEach(el => {
    el.textContent = el.getAttribute(key) ?? el.dataset.name;
  });
}

const parseEntryObjects = () => {
  document.querySelectorAll('.entry[data-extra]').forEach(el => {
    const obj = JSON.parse(el.dataset.extra);
    for (const attr in obj) {
      if (obj[attr] === null) {
        continue;
      }
      el.setAttribute(`data-${attr.replaceAll('_', '-')}`, obj[attr]);
    }
    delete el.dataset.extra;
  });
};

class TableSorter {
  constructor(parent) {
    this.parent = parent;
    this.parent?.querySelectorAll('.table-header[data-sort-by]').forEach(el => {
      el.addEventListener('click', e => this.sortBy(e, el.dataset.sortBy))
    });
    if(this.parent) {
      let isAscending = initialSortOrder.value === 'ascending';
      this.innerSortBy(`data-${initialSortBy.value}`, isAscending);
      const headers = Array.from(this.parent.querySelectorAll('.table-headers > .table-header'));
      headers.forEach(node => node.classList.remove('sorting-ascending', 'sorting-descending'));
      let element = headers.find(e => e.dataset.sortBy === initialSortBy.value);
      if(element != null) {
        element.classList.add(isAscending ? 'sorting-ascending' : 'sorting-descending');
      }
    }
  }

  innerSortBy(attribute, ascending) {
    let entries = [...this.parent.querySelectorAll('.entry')];
    if (entries.length === 0) {
      return;
    }
    let parent = entries[0].parentElement;
    entries.sort((a, b) => {
      if (attribute === 'data-name') {
        let firstName = a.textContent;
        let secondName = b.textContent;
        return ascending ? firstName.localeCompare(secondName) : secondName.localeCompare(firstName);
      } else {
        // The last two remaining sort options are either e.g. file.size or entry.last_modified
        // Both of these are numbers so they're simple to compare
        let first = parseInt(a.getAttribute(attribute), 10);
        let second = parseInt(b.getAttribute(attribute), 10);
        return ascending ? first - second : second - first;
      }
    });

    entries.forEach(obj => parent.appendChild(obj));
  }

  sortBy(event, attribute) {
    // Check if the element has an descending class tag
    // If it does, then when we're clicking on it we actually want to sort ascending
    let descending = !event.target.classList.contains('sorting-descending');

    // Make sure to toggle everything else off...
    this.parent.querySelectorAll('.table-headers > .table-header').forEach(node => node.classList.remove('sorting-ascending', 'sorting-descending'));

    // Sort the elements by what we requested
    this.innerSortBy(`data-${attribute}`, !descending);

    // Add the element class list depending on the operation we did
    let className = descending ? 'sorting-descending' : 'sorting-ascending';
    event.target.classList.add(className);
  }
}

let previousEntryOrder = null;

function resetSearchFilter() {
  if (filterElement.value.length === 0) {
    filterElement.focus();
  }

  let entries = [...document.querySelectorAll('.entry')];
  if (entries.length !== 0) {
    let parentNode = entries[0].parentNode;
    entries.forEach(e => e.classList.remove('hidden'));
    if (previousEntryOrder !== null) {
      previousEntryOrder.forEach(e => parentNode.appendChild(e));
      previousEntryOrder = null;
    }
  }

  filterElement.value = "";
  document.dispatchEvent(new CustomEvent('entries-filtered'));
}

function __scoreByName(el, query) {
  let total = __score(el.dataset.name, query);
  let native = el.dataset.japaneseName;
  if (native !== null) {
    total = Math.max(total, __score(native, query));
  }
  let english = el.dataset.englishName;
  if (english !== null) {
    total = Math.max(total, __score(english, query));
  }
  return total;
}

function filterEntries(query) {
  if (!query) {
    resetSearchFilter();
    return;
  }

  let entries = [...document.querySelectorAll('.entry')];
  // Save the previous file order so it can be reset when we're done filtering
  if (previousEntryOrder === null) {
    previousEntryOrder = entries;
  }

  if (entries.length === 0) {
    return;
  }

  let parentNode = entries[0].parentNode;
  let anilistId = getAnilistId(query);
  let tmdb = getTmdbId(query);
  let mapped = [];
  if (anilistId !== null) {
    mapped = entries.map(e => {
      let id = e.dataset.anilistId;
      return {
        entry: e,
        score: id !== null && parseInt(id, 10) === anilistId ? 0 : MIN_SCORE,
      };
    });
  } else if (tmdb !== null) {
    let tmdbId = `${tmdb.type}:${tmdb.id}`;
    mapped = entries.map(e => {
      let id = e.dataset.tmdbId;
      return {
        entry: e,
        score: id !== null && id == tmdbId ? 0 : MIN_SCORE,
      };
    });
  } else {
    mapped = entries.map(e => {
      return {
        entry: e,
        score: __scoreByName(e, query),
      };
    })
  }

  mapped.sort((a, b) => b.score - a.score).forEach(el => {
    el.entry.classList.toggle('hidden', el.score <= MIN_SCORE);
    parentNode.appendChild(el.entry);
  });

  document.dispatchEvent(new CustomEvent('entries-filtered'));
}

parseEntryObjects();
changeModifiedToRelative();
{
  let pref = localStorage.getItem('preferred_name') ?? 'romaji';
  if (pref != 'romaji') changeDisplayNames(pref);
}
settings.addEventListener('preferred-name', (e) => changeDisplayNames(e.detail));

let sorter = new TableSorter(document.querySelector('.files'));
document.getElementById('clear-search-filter')?.addEventListener('click', resetSearchFilter);
filterElement?.addEventListener('input', debounced(e => filterEntries(e.target.value)))
