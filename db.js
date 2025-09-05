import { showLoading, hideLoading } from './ui.js';

const DB_NAME = 'ColoringBookDB';
const DB_VERSION = 2;
const STORE_NAME = 'templates';
let db;

export function openColoringDB() {
  return new Promise((resolve, reject) => {
    showLoading();
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      db = event.target.result;
      let objectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
      if (!objectStore.indexNames.contains('category')) {
        objectStore.createIndex('category', 'category', { unique: false });
      }
    };
    request.onsuccess = (event) => {
      db = event.target.result;
      hideLoading();
      resolve(db);
    };
    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.errorCode);
      hideLoading();
      reject('IndexedDB error');
    };
  });
}

export function addTemplateToDB(name, dataUrl, category = '기본') {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ name: name, data: dataUrl, category: category });
    request.onsuccess = () => { hideLoading(); resolve(); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}

export function getTemplatesFromDB(category = 'all') {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    let request;
    if (category === 'all') {
      request = store.getAll();
    } else {
      const index = store.index('category');
      request = index.getAll(category);
    }
    request.onsuccess = () => { hideLoading(); resolve(request.result); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}

export function deleteTemplateFromDB(name) {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(name);
    request.onsuccess = () => { hideLoading(); resolve(); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}
