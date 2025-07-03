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
  auth.onAuthStateChanged(user => {
    if (!user) {
      console.log("Redirecting: No user logged in");
      window.location.href = 'index.html';
    } else {
      console.log("User authenticated:", user.email);
      setupUI();
      loadStock().catch(e => console.error("Initial stock load failed:", e));
    }
  });
});

function setupUI() {
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentCategory = e.target.dataset.category || e.target.textContent.trim();
      currentSubcategory = null;
      console.log(`Category changed to: ${currentCategory}`);
      loadStock().catch(e => console.error("Category load failed:", e));
    });
  });

  document.querySelectorAll('.subcategory-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentSubcategory = e.target.dataset.subcategory;
      console.log(`Subcategory changed to: ${currentSubcategory}`);
      loadStock().catch(e => console.error("Subcategory load failed:", e));
    });
  });

  document.getElementById('addProductBtn').addEventListener('click', showAddProductForm);
  document.getElementById('cancelBtn').addEventListener('click', hideAddProductForm);
  document.getElementById('addProductForm').addEventListener('submit', handleFormSubmit);

  document.getElementById('prodCategory').addEventListener('change', function () {
    const phoneSubcatField = document.getElementById('prodSubcategoryPhones');
    const tabletSubcatField = document.getElementById('prodSubcategoryTablets');
    phoneSubcatField.style.display = this.value === 'Phones' ? 'block' : 'none';
    tabletSubcatField.style.display = this.value === 'Tablets' ? 'block' : 'none';
  });

  document.getElementById('prodFreight').addEventListener('input', function () {
    document.getElementById('prodShipping').disabled = this.value && parseFloat(this.value) > 0;
  });

  document.getElementById('prodShipping').addEventListener('input', function () {
    document.getElementById('prodFreight').disabled = this.value && parseFloat(this.value) > 0;
  });

  document.getElementById('prodBarcode').addEventListener('keydown', function (e) {
    clearTimeout(barcodeTimeout);

    if (e.key === 'Enter') {
      e.preventDefault();
      processScannedBarcode(barcodeInputBuffer.trim());
      barcodeInputBuffer = '';
      return;
    }

    if (e.key.length === 1) {
      barcodeInputBuffer += e.key;
      barcodeTimeout = setTimeout(() => barcodeInputBuffer = '', BARCODE_DELAY);
    }
  });
}

async function loadStock() {
  const tbody = document.getElementById('stockTableBody');
  if (!tbody) {
    console.error("Stock table body not found!");
    return;
  }

  tbody.innerHTML = '<tr><td colspan="11" class="loading">Loading stock data...</td></tr>';

  try {
    let query = db.collection('stockmgt');

    if (currentCategory !== 'All') {
      query = query.where('category', '==', currentCategory);
    }
    if (currentSubcategory) {
      query = query.where('subcategory', '==', currentSubcategory);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="11">No products found in this category</td></tr>';
      return;
    }

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

    tr.innerHTML = `
      <td>${item.barcode || 'N/A'}</td>
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
      </td>
    `;

    tr.querySelector('.edit-btn').addEventListener('click', () => {
      populateFormForEdit(doc.id, item);
    });

    tbody.appendChild(tr);
  });
}

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
  document.getElementById('prodBarcode').value = item.barcode || '';
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
    barcode: document.getElementById('prodBarcode').value.trim(),
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (!formData.itemName || !formData.category || !formData.barcode) {
    alert('Please fill in all required fields');
    return;
  }

  try {
    if (editDocId) {
      await db.collection('stockmgt').doc(editDocId).update(formData);
      alert('Product updated successfully!');
    } else {
      const snapshot = await db.collection('stockmgt')
        .where('barcode', '==', formData.barcode)
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

async function processScannedBarcode(barcode) {
  if (!barcode) return;

  try {
    const snapshot = await db.collection('stockmgt')
      .where('barcode', '==', barcode)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      populateFormForEdit(doc.id, doc.data());
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

function playSound(type) {
  const audio = new Audio();
  audio.src = type === 'success'
    ? 'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3'
    : type === 'info'
    ? 'https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3'
    : 'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
  audio.play().catch(e => console.error("Audio error:", e));
}
