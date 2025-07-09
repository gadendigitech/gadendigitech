// Initialize Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD2WZnOuDXBLXR7uAq_LTK46q7tr13Mqvw",
  authDomain: "gadendigitech.firebaseapp.com",
  projectId: "gadendigitech",
  storageBucket: "gadendigitech.appspot.com",
  messagingSenderId: "134032321432",
  appId: "1:134032321432:web:dedbb189a68980661259ed",
  measurementId: "G-VLG9G3FCP0"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// Global variables
let currentCategory = 'All';
let currentSubcategory = null;
let editDocId = null;
let barcodeInputBuffer = '';
let barcodeTimeout;
const BARCODE_DELAY = 50;

let scannedBarcodes = []; // For multi-barcode input in add/edit product form
let multiProductList = []; // For multi-product entry list

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  auth.onAuthStateChanged(async user => {
    if (!user) {
      window.location.href = 'index.html';
    } else {
      console.log("User authenticated:", user.email);
      setupUI();
      await checkMigrationStatus();
      loadStock().catch(e => console.error("Initial stock load failed:", e));
    }
  });
});

// ==================== DATA MIGRATION ====================
async function checkMigrationStatus() {
  const migrationKey = 'barcodeMigrationComplete';
  if (!localStorage.getItem(migrationKey)) {
    try {
      await migrateToBarcodeArray();
      localStorage.setItem(migrationKey, 'true');
    } catch (error) {
      console.error("Migration error:", error);
    }
  }
}

async function migrateToBarcodeArray() {
  const snapshot = await db.collection('stockmgt')
    .where('barcodes', '==', null)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const fullSnapshot = await db.collection('stockmgt').get();
    const batch = db.batch();

    fullSnapshot.forEach(doc => {
      const data = doc.data();
      if (!data.barcodes) {
        batch.update(doc.ref, {
          barcodes: [data.barcode || generateFallbackBarcode(doc.id)].filter(Boolean),
          barcode: firebase.firestore.FieldValue.delete()
        });
      }
    });

    await batch.commit();
    console.log(`Migrated ${fullSnapshot.size} products`);
  }
}

function generateFallbackBarcode(id) {
  return `TEMP-${id.substring(0, 8)}`;
}

// ==================== UI SETUP ====================
function setupUI() {
  // Category buttons
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      currentCategory = e.target.dataset.category || e.target.textContent.trim();
      currentSubcategory = null;
      loadStock().catch(console.error);
    });
  });

  // Subcategory buttons
  document.querySelectorAll('.subcategory-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      currentSubcategory = e.target.dataset.subcategory;
      loadStock().catch(console.error);
    });
  });

  // Form controls
  document.getElementById('addProductBtn').addEventListener('click', showAddProductForm);
  document.getElementById('cancelBtn').addEventListener('click', hideAddProductForm);
  document.getElementById('addProductForm').addEventListener('submit', handleFormSubmit);

  // Category change dynamic subcategory display
  document.getElementById('prodCategory').addEventListener('change', function() {
    document.getElementById('prodSubcategoryPhones').style.display = this.value === 'Phones' ? 'block' : 'none';
    document.getElementById('prodSubcategoryTablets').style.display = this.value === 'Tablets' ? 'block' : 'none';
  });

  // Shipping/freight mutual exclusion
  document.getElementById('prodFreight').addEventListener('input', function() {
    document.getElementById('prodShipping').disabled = this.value && parseFloat(this.value) > 0;
  });
  document.getElementById('prodShipping').addEventListener('input', function() {
    document.getElementById('prodFreight').disabled = this.value && parseFloat(this.value) > 0;
  });

  // Global barcode scanner input buffer
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.id !== 'prodBarcodeInput') return;

    clearTimeout(barcodeTimeout);

    if (e.key === 'Enter' && barcodeInputBuffer.length > 0) {
      e.preventDefault();
      processScannedBarcode(barcodeInputBuffer.trim());
      barcodeInputBuffer = '';
      return;
    }

    if (/^[a-zA-Z0-9]$/.test(e.key)) {
      barcodeInputBuffer += e.key;
      barcodeTimeout = setTimeout(() => barcodeInputBuffer = '', BARCODE_DELAY);
    }
  });

  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', () => {
    auth.signOut().then(() => {
      window.location.href = 'index.html';
    });
  });

  // Admin migration button
  if (isAdminUser()) {
    const migrateBtn = document.createElement('button');
    migrateBtn.textContent = 'Migrate Barcodes';
    migrateBtn.className = 'migrate-btn';
    migrateBtn.addEventListener('click', migrateToBarcodeArray);
    document.querySelector('header').appendChild(migrateBtn);
  }

  // Setup barcode input and multi-product UI
  setupMultiBarcodeInput();
  setupMultiProductUI();
}

// ==================== STOCK LOADING ====================
async function loadStock() {
  const tbody = document.getElementById('stockTableBody');
  tbody.innerHTML = '<tr><td colspan="11" class="loading">Loading stock data...</td></tr>';

  try {
    let query = db.collection('stockmgt');
    if (currentCategory !== 'All') query = query.where('category', '==', currentCategory);
    if (currentSubcategory) query = query.where('subcategory', '==', currentSubcategory);

    const snapshot = await query.get();
    displayStockItems(snapshot.docs);
  } catch (error) {
    console.error("Stock loading error:", error);
    tbody.innerHTML = `<tr><td colspan="11" class="error">Error loading stock: ${error.message}</td></tr>`;
  }
}

function displayStockItems(docs) {
  const tbody = document.getElementById('stockTableBody');
  tbody.innerHTML = '';

  docs.forEach(doc => {
    const item = doc.data();
    const tr = document.createElement('tr');

    const barcodeDisplay = item.barcodes?.length > 1 
      ? `${item.barcodes[0]} (${item.barcodes.length})` 
      : item.barcodes?.[0] || 'N/A';

    tr.innerHTML = `
      <td>${barcodeDisplay}</td>
      <td>${item.itemName || 'Unnamed Product'}</td>
      <td>${item.category || 'Uncategorized'}</td>
      <td>${item.subcategory || '-'}</td>
      <td>${item.description || '-'}</td>
      <td>${item.costPrice?.toFixed(2) || '0.00'}</td>
      <td>${item.freight?.toFixed(2) || '0.00'}</td>
      <td>${item.shipping?.toFixed(2) || '0.00'}</td>
      <td>${item.sellingPrice?.toFixed(2) || '0.00'}</td>
      <td>${item.stockQty || 0}</td>
      <td class="actions">
        <button class="edit-btn" data-id="${doc.id}">Edit</button>
        <button class="barcode-btn" data-id="${doc.id}">Barcodes</button>
      </td>
    `;

    tr.querySelector('.edit-btn').addEventListener('click', () => populateFormForEdit(doc.id, item));
    tr.querySelector('.barcode-btn').addEventListener('click', () => showBarcodeManager(doc.id, item));
    tbody.appendChild(tr);
  });
}

// ==================== MULTI-BARCODE INPUT FOR SINGLE PRODUCT ====================
function setupMultiBarcodeInput() {
  const barcodeInput = document.getElementById('prodBarcodeInput');
  const addBarcodeBtn = document.getElementById('addBarcodeBtn');
  const clearBarcodesBtn = document.getElementById('clearBarcodesBtn');

  addBarcodeBtn.addEventListener('click', () => {
    const barcode = barcodeInput.value.trim();
    if (!barcode) {
      alert('Please enter or scan a barcode.');
      return;
    }
    if (scannedBarcodes.includes(barcode)) {
      alert('This barcode is already added.');
      barcodeInput.value = '';
      return;
    }
    scannedBarcodes.push(barcode);
    updateBarcodeListUI();
    barcodeInput.value = '';
    barcodeInput.focus();
  });

  barcodeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBarcodeBtn.click();
    }
  });

  clearBarcodesBtn.addEventListener('click', () => {
    scannedBarcodes = [];
    updateBarcodeListUI();
    barcodeInput.focus();
  });
}

function updateBarcodeListUI() {
  const container = document.getElementById('barcodeListContainer');
  container.innerHTML = '';
  scannedBarcodes.forEach((code, index) => {
    const tag = document.createElement('span');
    tag.className = 'barcode-tag';
    tag.textContent = code;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove barcode';
    removeBtn.style.marginLeft = '6px';
    removeBtn.addEventListener('click', () => {
      scannedBarcodes.splice(index, 1);
      updateBarcodeListUI();
    });

    tag.appendChild(removeBtn);
    container.appendChild(tag);
  });
}

// ==================== ADD/EDIT PRODUCT FORM ====================
function showAddProductForm() {
  resetForm();
  document.getElementById('formTitle').textContent = 'Add New Product';
  document.getElementById('formSubmitBtn').textContent = 'Add Product';
  document.getElementById('addProductSection').style.display = 'block';
  document.getElementById('prodName').focus();

  scannedBarcodes = [];
  updateBarcodeListUI();
}

function hideAddProductForm() {
  document.getElementById('addProductSection').style.display = 'none';
  resetForm();
}

function resetForm() {
  document.getElementById('addProductForm').reset();
  document.getElementById('prodSubcategoryPhones').style.display = 'none';
  document.getElementById('prodSubcategoryTablets').style.display = 'none';
  editDocId = null;
  document.getElementById('prodShipping').disabled = false;
  document.getElementById('prodFreight').disabled = false;
  document.getElementById('prodBarcodeInput').disabled = false;

  scannedBarcodes = [];
  updateBarcodeListUI();
}

function populateFormForEdit(docId, item) {
  editDocId = docId;
  document.getElementById('formTitle').textContent = 'Edit Product';
  document.getElementById('formSubmitBtn').textContent = 'Update Product';

  document.getElementById('prodName').value = item.itemName || '';
  document.getElementById('prodCategory').value = item.category || '';

  document.getElementById('prodSubcategoryPhones').style.display = item.category === 'Phones' ? 'block' : 'none';
  document.getElementById('prodSubcategoryTablets').style.display = item.category === 'Tablets' ? 'block' : 'none';

  if (item.category === 'Phones') {
    document.getElementById('prodSubcategoryPhones').value = item.subcategory || '';
  } else if (item.category === 'Tablets') {
    document.getElementById('prodSubcategoryTablets').value = item.subcategory || '';
  }

  document.getElementById('prodDescription').value = item.description || '';
  document.getElementById('prodCostPrice').value = item.costPrice || '';
  document.getElementById('prodFreight').value = item.freight || '';
  document.getElementById('prodShipping').value = item.shipping || '';
  document.getElementById('prodSellingPrice').value = item.sellingPrice || '';
  document.getElementById('prodStockQty').value = item.stockQty || '';

  document.getElementById('prodBarcodeInput').value = '';
  document.getElementById('prodBarcodeInput').disabled = true;

  scannedBarcodes = Array.isArray(item.barcodes) ? [...item.barcodes] : [];
  updateBarcodeListUI();

  document.getElementById('addProductSection').style.display = 'block';
  document.getElementById('prodName').focus();
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const category = document.getElementById('prodCategory').value;
  const subcategory = category === 'Phones'
    ? document.getElementById('prodSubcategoryPhones').value
    : category === 'Tablets'
    ? document.getElementById('prodSubcategoryTablets').value
    : null;

  const formData = {
    itemName: document.getElementById('prodName').value.trim(),
    category,
    subcategory,
    description: document.getElementById('prodDescription').value.trim(),
    costPrice: parseFloat(document.getElementById('prodCostPrice').value) || 0,
    freight: parseFloat(document.getElementById('prodFreight').value) || 0,
    shipping: parseFloat(document.getElementById('prodShipping').value) || 0,
    sellingPrice: parseFloat(document.getElementById('prodSellingPrice').value) || 0,
    stockQty: parseInt(document.getElementById('prodStockQty').value) || 0,
    barcodes: scannedBarcodes.filter(bc => bc.trim() !== ''),
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (!formData.itemName || !formData.category || formData.barcodes.length === 0) {
    alert('Please fill in all required fields and add at least one barcode.');
    return;
  }

  try {
    if (editDocId) {
      const duplicates = await checkBarcodeDuplicates(formData.barcodes, editDocId);
      if (duplicates.length > 0) {
        alert(`Barcode(s) ${duplicates.join(', ')} already exist in other products.`);
        return;
      }
      await db.collection('stockmgt').doc(editDocId).update(formData);
      alert('Product updated successfully!');
    } else {
      const duplicates = await checkBarcodeDuplicates(formData.barcodes);
      if (duplicates.length > 0) {
        alert(`Barcode(s) ${duplicates.join(', ')} already exist in other products.`);
        return;
      }
      await db.collection('stockmgt').add(formData);
      alert('Product added successfully!');
    }

    hideAddProductForm();
    loadStock();
  } catch (error) {
    console.error("Error saving product:", error);
    alert(`Error: ${error.message}`);
  }
}

// Check barcode duplicates
async function checkBarcodeDuplicates(barcodes, excludeDocId = null) {
  const duplicates = [];
  for (const barcode of barcodes) {
    const snapshot = await db.collection('stockmgt')
      .where('barcodes', 'array-contains', barcode)
      .get();

    snapshot.forEach(doc => {
      if (doc.id !== excludeDocId) {
        duplicates.push(barcode);
      }
    });
  }
  return duplicates;
}

// ==================== MULTI-PRODUCT ENTRY UI ====================
function setupMultiProductUI() {
  document.getElementById('saveAllBtn').addEventListener('click', saveAllProducts);
  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (confirm('Clear all products from the current entry list?')) {
      multiProductList = [];
      renderMultiProductTable();
      document.getElementById('multiProductSection').style.display = 'none';
    }
  });
}

function addProductToMultiEntry(productId, productData, scannedBarcode) {
  const existingIndex = multiProductList.findIndex(p => p.productId === productId);
  if (existingIndex >= 0) {
    multiProductList[existingIndex].quantity += 1;
  } else {
    multiProductList.push({
      productId,
      barcode: scannedBarcode,
      itemName: productData.itemName || '',
      category: productData.category || '',
      costPrice: productData.costPrice || 0,
      sellingPrice: productData.sellingPrice || 0,
      quantity: 1
    });
  }
  renderMultiProductTable();
  document.getElementById('multiProductSection').style.display = 'block';
}

function renderMultiProductTable() {
  const tbody = document.getElementById('multiProductTableBody');
  tbody.innerHTML = '';
  multiProductList.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.barcode}</td>
      <td>${item.itemName}</td>
      <td>${item.category}</td>
      <td><input type="number" min="1" value="${item.quantity}" data-index="${index}" class="multi-qty-input" style="width: 60px;" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.costPrice}" data-index="${index}" class="multi-cost-input" style="width: 80px;" /></td>
      <td><input type="number" min="0" step="0.01" value="${item.sellingPrice}" data-index="${index}" class="multi-selling-input" style="width: 80px;" /></td>
      <td><button type="button" class="remove-multi-btn" data-index="${index}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.multi-qty-input').forEach(input => {
    input.addEventListener('change', e => {
      const i = parseInt(e.target.dataset.index);
      let val = parseInt(e.target.value);
      if (isNaN(val) || val < 1) val = 1;
      multiProductList[i].quantity = val;
      e.target.value = val;
    });
  });
  tbody.querySelectorAll('.multi-cost-input').forEach(input => {
    input.addEventListener('change', e => {
      const i = parseInt(e.target.dataset.index);
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) val = 0;
      multiProductList[i].costPrice = val;
      e.target.value = val.toFixed(2);
    });
  });
  tbody.querySelectorAll('.multi-selling-input').forEach(input => {
    input.addEventListener('change', e => {
      const i = parseInt(e.target.dataset.index);
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) val = 0;
      multiProductList[i].sellingPrice = val;
      e.target.value = val.toFixed(2);
    });
  });
  tbody.querySelectorAll('.remove-multi-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = parseInt(e.target.dataset.index);
      multiProductList.splice(i, 1);
      renderMultiProductTable();
      if (multiProductList.length === 0) {
        document.getElementById('multiProductSection').style.display = 'none';
      }
    });
  });
}

async function saveAllProducts() {
  if (multiProductList.length === 0) {
    alert('No products to save.');
    return;
  }

  const batch = db.batch();
  const stockRef = db.collection('stockmgt');

  try {
    for (const item of multiProductList) {
      const productDoc = await stockRef.doc(item.productId).get();
      if (!productDoc.exists) {
        alert(`Product ${item.itemName} not found in database.`);
        continue;
      }
      batch.update(stockRef.doc(item.productId), {
        stockQty: firebase.firestore.FieldValue.increment(item.quantity),
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    alert('All products saved successfully!');
    multiProductList = [];
    renderMultiProductTable();
    document.getElementById('multiProductSection').style.display = 'none';
    loadStock();
  } catch (error) {
    console.error('Error saving products:', error);
    alert('Error saving products. Check console for details.');
  }
}

// ==================== PROCESS SCANNED BARCODE ====================
async function processScannedBarcode(barcode) {
  if (!barcode || barcode.length < 3) {
    playSound('error');
    return;
  }

  try {
    const snapshot = await db.collection('stockmgt')
      .where('barcodes', 'array-contains', barcode)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const productData = doc.data();
      addProductToMultiEntry(doc.id, productData, barcode);
      playSound('success');
    } 
  } catch (error) {
    console.error("Barcode error:", error);
    playSound('error');
  }
}

// ==================== BARCODE MANAGEMENT MODALS ====================
function showBarcodeManager(productId, productData) {
  const modal = document.createElement('div');
  modal.className = 'barcode-modal';
  
  const barcodes = productData.barcodes || [];
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Manage Barcodes: ${productData.itemName}</h3>
      <ul class="barcode-list">
        ${barcodes.map(barcode => `
          <li>
            <span>${barcode}</span>
            <button class="remove-barcode" data-barcode="${barcode}">×</button>
          </li>
        `).join('')}
      </ul>
      <div class="add-barcode">
        <input type="text" id="newBarcodeInput" placeholder="New barcode" />
        <button id="addBarcodeBtn">Add</button>
      </div>
      <button id="closeBarcodeModal">Close</button>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll('.remove-barcode').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (barcodes.length <= 1) {
        alert("Products must have at least one barcode");
        return;
      }
      if (confirm(`Remove barcode ${e.target.dataset.barcode}?`)) {
        await removeBarcode(productId, e.target.dataset.barcode);
        modal.remove();
        loadStock();
      }
    });
  });

  modal.querySelector('#addBarcodeBtn').addEventListener('click', async () => {
    const newBarcode = modal.querySelector('#newBarcodeInput').value.trim();
    if (newBarcode) {
      const success = await addBarcodeToProduct(productId, newBarcode);
      if (success) {
        modal.remove();
        loadStock();
      }
    }
  });

  modal.querySelector('#closeBarcodeModal').addEventListener('click', () => modal.remove());
}

async function addBarcodeToProduct(productId, newBarcode) {
  try {
    const duplicates = await checkBarcodeDuplicates([newBarcode], productId);
    if (duplicates.length > 0) {
      alert('This barcode is already assigned to another product!');
      return false;
    }

    await db.collection('stockmgt').doc(productId).update({
      barcodes: firebase.firestore.FieldValue.arrayUnion(newBarcode)
    });
    alert('Barcode added successfully!');
    return true;
  } catch (error) {
    console.error("Error adding barcode:", error);
    alert(`Error: ${error.message}`);
    return false;
  }
}

async function removeBarcode(productId, barcodeToRemove) {
  try {
    await db.collection('stockmgt').doc(productId).update({
      barcodes: firebase.firestore.FieldValue.arrayRemove(barcodeToRemove)
    });
    alert('Barcode removed successfully!');
    return true;
  } catch (error) {
    console.error("Error removing barcode:", error);
    alert(`Error: ${error.message}`);
    return false;
  }
}

// ==================== STOCK QUANTITY UPDATE ====================
async function increaseStockQuantity(productId, currentQty) {
  const newQty = prompt(`Current quantity: ${currentQty}\nEnter amount to add:`, "1");
  
  if (newQty && !isNaN(newQty)) {
    try {
      await db.collection('stockmgt').doc(productId).update({
        stockQty: firebase.firestore.FieldValue.increment(parseInt(newQty))
      });
      alert(`Stock increased by ${newQty}`);
      loadStock();
    } catch (error) {
      console.error("Error updating stock:", error);
      alert(`Error: ${error.message}`);
    }
  }
}

// ==================== UTILITY FUNCTIONS ====================
function isAdminUser() {
  // Implement your admin check logic here
  return false; // Change as needed
}

function playSound(type) {
  const audio = new Audio();
  audio.src = type === 'success' 
    ? 'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3'
    : type === 'info'
    ? 'https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3'
    : 'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
  audio.play().catch(e => console.error("Audio error:", e));
}
