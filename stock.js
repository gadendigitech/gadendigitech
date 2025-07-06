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

// ==================== MAIN FUNCTIONS ====================
function setupUI() {
  // Category buttons
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentCategory = e.target.dataset.category || e.target.textContent.trim();
      currentSubcategory = null;
      loadStock().catch(e => console.error("Category load failed:", e));
    });
  });

  // Subcategory buttons
  document.querySelectorAll('.subcategory-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentSubcategory = e.target.dataset.subcategory;
      loadStock().catch(e => console.error("Subcategory load failed:", e));
    });
  });

  // Form controls
  document.getElementById('addProductBtn').addEventListener('click', showAddProductForm);
  document.getElementById('cancelBtn').addEventListener('click', hideAddProductForm);
  document.getElementById('addProductForm').addEventListener('submit', handleFormSubmit);

  // Dynamic form fields
  document.getElementById('prodCategory').addEventListener('change', function() {
    const phoneSubcat = document.getElementById('prodSubcategoryPhones');
    const tabletSubcat = document.getElementById('prodSubcategoryTablets');
    phoneSubcat.style.display = this.value === 'Phones' ? 'block' : 'none';
    tabletSubcat.style.display = this.value === 'Tablets' ? 'block' : 'none';
  });

  // Shipping/freight toggle
  document.getElementById('prodFreight').addEventListener('input', function() {
    document.getElementById('prodShipping').disabled = this.value && parseFloat(this.value) > 0;
  });
  document.getElementById('prodShipping').addEventListener('input', function() {
    document.getElementById('prodFreight').disabled = this.value && parseFloat(this.value) > 0;
  });

  // Barcode scanner input
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' && e.target.id !== 'prodBarcode') return;
    
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

  // Add migration button for admin
  if (isAdminUser()) {
    const migrateBtn = document.createElement('button');
    migrateBtn.textContent = 'Migrate Barcodes';
    migrateBtn.className = 'migrate-btn';
    migrateBtn.addEventListener('click', migrateToBarcodeArray);
    document.querySelector('header').appendChild(migrateBtn);
  }
}

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

    // Display first barcode + indicator if multiple exist
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

// ==================== PRODUCT FORM FUNCTIONS ====================
function showAddProductForm() {
  resetForm();
  document.getElementById('formTitle').textContent = 'Add New Product';
  document.getElementById('formSubmitBtn').textContent = 'Add Product';
  document.getElementById('addProductSection').style.display = 'block';
  document.getElementById('prodName').focus();
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
  document.getElementById('prodBarcode').disabled = false;
}

function populateFormForEdit(docId, item) {
  editDocId = docId;
  document.getElementById('formTitle').textContent = 'Edit Product';
  document.getElementById('formSubmitBtn').textContent = 'Update Product';

  document.getElementById('prodName').value = item.itemName || '';
  document.getElementById('prodCategory').value = item.category || '';

  const phoneSubcat = document.getElementById('prodSubcategoryPhones');
  const tabletSubcat = document.getElementById('prodSubcategoryTablets');

  phoneSubcat.style.display = item.category === 'Phones' ? 'block' : 'none';
  tabletSubcat.style.display = item.category === 'Tablets' ? 'block' : 'none';

  if (item.category === 'Phones') {
    phoneSubcat.value = item.subcategory || '';
  } else if (item.category === 'Tablets') {
    tabletSubcat.value = item.subcategory || '';
  }

  document.getElementById('prodDescription').value = item.description || '';
  document.getElementById('prodCostPrice').value = item.costPrice || '';
  document.getElementById('prodFreight').value = item.freight || '';
  document.getElementById('prodShipping').value = item.shipping || '';
  document.getElementById('prodSellingPrice').value = item.sellingPrice || '';
  document.getElementById('prodStockQty').value = item.stockQty || '';
  document.getElementById('prodBarcode').value = item.barcodes?.[0] || '';
  document.getElementById('prodBarcode').disabled = true;

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
    barcodes: [document.getElementById('prodBarcode').value.trim()],
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (!formData.itemName || !formData.category || !formData.barcodes[0]) {
    alert('Please fill in all required fields');
    return;
  }

  try {
    if (editDocId) {
      // For editing, keep existing barcodes
      const existingProduct = await db.collection('stockmgt').doc(editDocId).get();
      formData.barcodes = existingProduct.data().barcodes || formData.barcodes;
      
      await db.collection('stockmgt').doc(editDocId).update(formData);
      alert('Product updated successfully!');
    } else {
      // Check for duplicate barcode
      const barcode = formData.barcodes[0];
      const snapshot = await db.collection('stockmgt')
        .where('barcodes', 'array-contains', barcode)
        .get();

      if (!snapshot.empty) {
        alert('Product with this barcode already exists!');
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

// ==================== BARCODE MANAGEMENT ====================
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
      showProductOptions(doc.id, productData, barcode);
      playSound('success');
    } else {
      showAddProductForm();
      document.getElementById('prodBarcode').value = barcode;
      document.getElementById('prodName').focus();
      playSound('info');
    }
  } catch (error) {
    console.error("Barcode error:", error);
    playSound('error');
  }
}

function showProductOptions(productId, productData, scannedBarcode) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>${productData.itemName}</h3>
      <p>Barcode: ${scannedBarcode}</p>
      <p>Current Stock: ${productData.stockQty}</p>
      <p>${productData.barcodes.length > 1 ? `(${productData.barcodes.length} barcodes)` : ''}</p>
      
      <div class="modal-actions">
        <button id="increaseStockBtn">Increase Stock</button>
        <button id="addAnotherBarcodeBtn">Add Another Barcode</button>
        <button id="editProductBtn">Edit Product</button>
        <button id="viewBarcodesBtn">View All Barcodes</button>
        <button id="cancelModalBtn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('increaseStockBtn').addEventListener('click', () => {
    increaseStockQuantity(productId, productData.stockQty);
    modal.remove();
  });

  document.getElementById('addAnotherBarcodeBtn').addEventListener('click', () => {
    addNewBarcodeToProduct(productId);
    modal.remove();
  });

  document.getElementById('editProductBtn').addEventListener('click', () => {
    populateFormForEdit(productId, productData);
    modal.remove();
  });

  document.getElementById('viewBarcodesBtn').addEventListener('click', () => {
    viewAllBarcodes(productData.barcodes);
    modal.remove();
  });

  document.getElementById('cancelModalBtn').addEventListener('click', () => {
    modal.remove();
  });
}

async function showBarcodeManager(productId, productData) {
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
        <input type="text" id="newBarcodeInput" placeholder="New barcode">
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
    // Check for duplicate across all products
    const snapshot = await db.collection('stockmgt')
      .where('barcodes', 'array-contains', newBarcode)
      .get();

    if (!snapshot.empty) {
      alert('This barcode is already assigned to another product!');
      return false;
    }

    await db.collection('stockmgt').doc(productId).update({
      barcodes: firebase.firestore.FieldValue.arrayUnion(newBarcode)
    });
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
    return true;
  } catch (error) {
    console.error("Error removing barcode:", error);
    return false;
  }
}

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

function viewAllBarcodes(barcodes) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>All Barcodes</h3>
      <ul class="barcode-list">
        ${barcodes.map(barcode => `<li>${barcode}</li>`).join('')}
      </ul>
      <button id="closeBarcodesBtn">Close</button>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('closeBarcodesBtn').addEventListener('click', () => modal.remove());
}

// ==================== UTILITY FUNCTIONS ====================
function isAdminUser() {
  // Implement your admin check logic
  return false; // Change based on your auth system
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
