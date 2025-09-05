import { showLoading, hideLoading } from './ui.js';

const DB_NAME = 'ColoringBookDB';
const DB_VERSION = 3; // Version increased to 3
const TEMPLATES_STORE_NAME = 'templates'; // Renamed for clarity
const CATEGORIES_STORE_NAME = 'categories'; // New store name
let db;

export function openColoringDB() {
  return new Promise((resolve, reject) => {
    showLoading();
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      db = event.target.result;
      // Create templates object store if it doesn't exist
      if (!db.objectStoreNames.contains(TEMPLATES_STORE_NAME)) {
        const templatesStore = db.createObjectStore(TEMPLATES_STORE_NAME, { keyPath: 'name' });
        templatesStore.createIndex('category', 'category', { unique: false });
      } else {
        // If templates store already exists, ensure category index is there
        const templatesStore = request.transaction.objectStore(TEMPLATES_STORE_NAME);
        if (!templatesStore.indexNames.contains('category')) {
          templatesStore.createIndex('category', 'category', { unique: false });
        }
      }

      // Create categories object store if it doesn't exist
      if (!db.objectStoreNames.contains(CATEGORIES_STORE_NAME)) {
        db.createObjectStore(CATEGORIES_STORE_NAME, { keyPath: 'name' });
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
    const transaction = db.transaction([TEMPLATES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(TEMPLATES_STORE_NAME);
    const request = store.put({ name: name, data: dataUrl, category: category });
    request.onsuccess = () => { hideLoading(); resolve(); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}

export function getTemplatesFromDB(category = 'all') {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([TEMPLATES_STORE_NAME], 'readonly');
    const store = transaction.objectStore(TEMPLATES_STORE_NAME);
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
    const transaction = db.transaction([TEMPLATES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(TEMPLATES_STORE_NAME);
    const request = store.delete(name);
    request.onsuccess = () => { hideLoading(); resolve(); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}

// New functions for category management
export function addCategoryToDB(categoryName) {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([CATEGORIES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CATEGORIES_STORE_NAME);
    const request = store.add({ name: categoryName }); // Use add to prevent overwriting
    request.onsuccess = () => { hideLoading(); resolve(); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}

export function getCategoriesFromDB() {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([CATEGORIES_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CATEGORIES_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => { hideLoading(); resolve(request.result); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}

export function deleteCategoryFromDB(categoryName) {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([CATEGORIES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CATEGORIES_STORE_NAME);
    const request = store.delete(categoryName);
    request.onsuccess = () => { hideLoading(); resolve(); };
    request.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}

// Function to update a template's category (if needed later)
export function updateTemplateCategoryInDB(templateName, newCategory) {
  return new Promise((resolve, reject) => {
    showLoading();
    const transaction = db.transaction([TEMPLATES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(TEMPLATES_STORE_NAME);
    const getRequest = store.get(templateName);

    getRequest.onsuccess = () => {
      const template = getRequest.result;
      if (template) {
        template.category = newCategory;
        const putRequest = store.put(template);
        putRequest.onsuccess = () => { hideLoading(); resolve(); };
        putRequest.onerror = (event) => { hideLoading(); reject(event.target.error); };
      } else {
        hideLoading();
        reject('Template not found');
      }
    };
    getRequest.onerror = (event) => { hideLoading(); reject(event.target.error); };
  });
}