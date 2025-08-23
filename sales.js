
// --- GLOBAL CONSTANTS ---
if (typeof window.BARCODE_DELAY === 'undefined') {
  window.BARCODE_DELAY = 100; // ms between keystrokes
}
if (typeof window.MANUAL_DIGITS === 'undefined') {
  window.MANUAL_DIGITS = 6; // manual entry length
}

// --- FIREBASE INITIALIZATION ---
if (!firebase.apps.length) {
  firebase.initializeApp({
    apiKey: "AIzaSyD2WZnOuDXBLXR7uAq_LTK46q7tr13Mqvw",
    authDomain: "gadendigitech.firebaseapp.com",
    projectId: "gadendigitech",
    storageBucket: "gadendigitech.appspot.com",
    messagingSenderId: "134032321432",
    appId: "1:134032321432:web:dedbb18980661259ed",
    measurementId: "G-VLG9G3FCP0"
  });
}
const auth = firebase.auth();
const db = firebase.firestore();
window.db = db;

// --- STATE ---
let products = [];
let currentSaleItems = [];
let barcodeInputBuffer = '';
let barcodeTimeout;
let barcodeInputTimeout;

// Track scanned barcodes within *current* transaction only
window.currentSessionScannedBarcodes = [];

// --- AUTH & APP INIT ---
auth.onAuthStateChanged(user => {
  if (!user) {
    window.location = 'index.html';
  } else {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      initializeApp();
    } else {
      document.addEventListener('DOMContentLoaded', initializeApp);
    }
  }
});

async function initializeApp() {
  try {
    console.log("Initializing application...");

    // Load essential data first
    await loadProducts();

    // Setup UI components
    setupFilterButtons();
    setupClearFilterButtons();
    setupSaleTypeToggle();
    setupBarcodeScanner();
    setupSalesForm();

    // Load initial data
    await Promise.all([
      loadSalesRecords(),
      calculateProfit()
    ]);

    // Focus barcode input
    const barcodeInput = document.getElementById('saleBarcode');
    if (barcodeInput) {
      barcodeInput.focus();
      barcodeInput.value = '';
    }

    // Set current date
    const saleDateEl = document.getElementById('saleDate');
    if (saleDateEl) saleDateEl.valueAsDate = new Date();

    // Other listeners
    document.getElementById('logoutBtn')?.addEventListener('click', () => auth.signOut());

    // Ensure new-sale session tracking is clear
    setupNewSale();

    console.log("Initialization complete");
  } catch (error) {
    console.error('Initialization error:', error);
    alert('Error initializing application. Check console for details.');
  }
}

// --- SALE TYPE TOGGLE WITH CREDIT FIELDS ---
function setupSaleTypeToggle() {
  const saleTypeSelect = document.getElementById('saleType');
  const creditFields = document.getElementById('creditFields');

  if (!saleTypeSelect || !creditFields) {
    console.warn('Required elements for sale type toggle not found');
    return;
  }

  function toggleCreditFields() {
    if (saleTypeSelect.value === 'credit') {
      creditFields.style.display = 'block';
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);
      document.getElementById('dueDate').valueAsDate = dueDate;
      document.getElementById('initialPayment').value = '0';
    } else {
      creditFields.style.display = 'none';
    }
  }

  saleTypeSelect.addEventListener('change', toggleCreditFields);
  toggleCreditFields();
}

// --- FILTER BUTTONS ---
function setupFilterButtons() {
  const filterButton = document.getElementById('filterSalesButton');
  if (filterButton) {
    filterButton.addEventListener('click', function () {
      const fromDate = document.getElementById('filterSalesFromDate').value;
      const toDate = document.getElementById('filterSalesToDate').value;
      const clientName = document.getElementById('filterSalesClientName').value.trim();

      const filters = {};
      if (fromDate) filters.fromDate = fromDate;
      if (toDate) filters.toDate = toDate;
      if (clientName) filters.clientName = clientName;

      loadSalesRecords(filters);
      calculateProfit(filters);
    });
  }
}

function setupClearFilterButtons() {
  const clearBtn = document.getElementById('clearSalesFilterButton');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      document.getElementById('filterSalesFromDate').value = '';
      document.getElementById('filterSalesToDate').value = '';
      document.getElementById('filterSalesClientName').value = '';
      loadSalesRecords();
      calculateProfit();
    });
  }
}

// --- PRODUCT LOADING ---
async function loadProducts() {
  try {
    const snapshot = await db.collection('stockmgt').get();
    products = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        itemName: data.itemName || 'Unknown',
        sellingPrice: data.sellingPrice || 0,
        costPrice: data.costPrice || 0,
        category: data.category || '',
        stockQty: data.stockQty || 0,
        barcodes: Array.isArray(data.barcodes) ? data.barcodes : [],
        shippingCost: data.shippingCost || 0
      };
    });
    console.log(`Loaded ${products.length} products`);
  } catch (error) {
    console.error('Failed to load products:', error);
    alert('Failed to load product inventory. Please refresh the page.');
    products = [];
  }
}

// --- BARCODE SCANNING SYSTEM ---
function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('saleBarcode');
  if (!barcodeInput) {
    console.error('Barcode input element not found!');
    return;
  }

  // Clear previous listeners
  barcodeInput.removeEventListener('keypress', handleBarcodeKeypress);
  barcodeInput.removeEventListener('input', handleBarcodeInput);

  // Add fresh listeners
  barcodeInput.addEventListener('keypress', handleBarcodeKeypress);
  barcodeInput.addEventListener('input', handleBarcodeInput);
  barcodeInput.focus();
}

function handleBarcodeKeypress(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = e.target.value.trim();

    if (input.length === MANUAL_DIGITS) {
      handleManualInput(input);
    } else {
      processScannedBarcode(input);
    }

    e.target.value = '';
  }
}

function handleBarcodeInput(e) {
  clearTimeout(barcodeInputTimeout);
  const input = e.target.value.trim();

  if (input.length >= 8) {
    barcodeInputTimeout = setTimeout(() => {
      processScannedBarcode(input);
      e.target.value = '';
    }, BARCODE_DELAY);
  } else if (input.length === MANUAL_DIGITS) {
    barcodeInputTimeout = setTimeout(() => {
      handleManualInput(input);
      e.target.value = '';
    }, BARCODE_DELAY);
  }
}

async function handleManualInput(last6Digits) {
  if (!last6Digits || last6Digits.length !== MANUAL_DIGITS) {
    alert('Please enter exactly 6 digits');
    return;
  }

  try {
    const matchingProducts = products.filter(p =>
      Array.isArray(p.barcodes) &&
      p.barcodes.some(bc => bc.endsWith(last6Digits))
    );

    if (matchingProducts.length === 1) {
      const fullBarcode = matchingProducts[0].barcodes.find(bc => bc.endsWith(last6Digits));
      await addProductToSale(matchingProducts[0], fullBarcode);
    } else if (matchingProducts.length > 1) {
      alert(`Multiple products match last 6 digits. Please scan full barcode.`);
      playSound('error');
    } else {
      alert(`No product found with matching last 6 digits: ${last6Digits}`);
      playSound('error');
    }
  } catch (error) {
    console.error("Manual input error:", error);
    alert('Error processing manual input. Please try again.');
  }
}

async function processScannedBarcode(fullBarcode) {
  if (!fullBarcode || fullBarcode.length < 8) {
    alert('Invalid barcode. Please scan again or enter last 6 digits.');
    return;
  }

  try {
    let product = products.find(p => Array.isArray(p.barcodes) && p.barcodes.includes(fullBarcode));

    if (!product) {
      const snapshot = await db
        .collection('stockmgt')
        .where('barcodes', 'array-contains', fullBarcode)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        product = { id: doc.id, ...doc.data() };
        products.push(product);
      }
    }

    if (product) {
      await addProductToSale(product, fullBarcode);
    } else {
      alert(`Product with barcode "${fullBarcode}" not found!`);
      playSound('error');
    }
  } catch (error) {
    console.error("Barcode processing error:", error);
    alert('Error processing barcode. Please try again.');
  }
}

async function addProductToSale(product, barcode) {
  if (!product || !barcode) return;

  // Normalize the barcode input
  const scannedBarcode = barcode.toString().trim();

  // Track scanned barcodes just for this sale session
  if (!window.currentSessionScannedBarcodes) {
    window.currentSessionScannedBarcodes = [];
  }

  // Check for duplicate scan ONLY within current sale
  if (window.currentSessionScannedBarcodes.includes(scannedBarcode)) {
    alert(`Barcode ${scannedBarcode} already scanned in this transaction!`);
    playSound('error');
    return;
  }

  // Stock check
  if ((product.stockQty || 0) <= 0) {
    console.warn('Product is out of stock!');
    return; // Exit if out of stock
  }

  // Add to tracked barcodes
  window.currentSessionScannedBarcodes.push(scannedBarcode);

  const existingIndex = currentSaleItems.findIndex(item => item.id === product.id);

  if (existingIndex >= 0) {
    // Update existing product in current sale
    currentSaleItems[existingIndex].scannedBarcodes.push(scannedBarcode);
    currentSaleItems[existingIndex].quantity = currentSaleItems[existingIndex].scannedBarcodes.length;
    currentSaleItems[existingIndex].total =
      currentSaleItems[existingIndex].sellingPrice * currentSaleItems[existingIndex].quantity;
  } else {
    // Add new product to current sale
    currentSaleItems.push({
      id: product.id,
      itemName: product.itemName,
      sellingPrice: product.sellingPrice,
      costPrice: product.costPrice,
      shippingCost: product.shippingCost || 0,
      category: product.category,
      stockQty: product.stockQty,
      scannedBarcodes: [scannedBarcode],
      quantity: 1,
      total: product.sellingPrice,
      totalCost: product.costPrice + (product.shippingCost || 0)
    });
  }

  updateSaleSummary();
  playSound('success');
  document.getElementById('saleBarcode').focus();
}

// Reset scanned barcodes when starting new sale
function setupNewSale() {
  window.currentSessionScannedBarcodes = [];
}

// --- SALE SUMMARY ---
function updateSaleSummary() {
  const container = document.getElementById('saleItemsContainer');
  if (!container) return;

  container.innerHTML = '';
  let subtotal = 0;

  currentSaleItems.forEach((item, index) => {
    const quantity = item.scannedBarcodes.length;
    const itemTotal = item.sellingPrice * quantity;
    subtotal += itemTotal;

    const div = document.createElement('div');
    div.className = 'sale-item';
    div.innerHTML = `
      <div class="product-info">
        <strong>${item.itemName}</strong>
        <div>Category: ${item.category}</div>
        <div>Barcodes: ${item.scannedBarcodes.join(', ')}</div>
      </div>
      <div class="price-info">
        <div>Price: <input type="number" class="sale-unit-price" data-index="${index}" value="${item.sellingPrice.toFixed(2)}" min="0" step="0.01"/></div>
        <div>Qty: <input type="number" class="sale-quantity" data-index="${index}" value="${quantity}" min="1"/></div>
        <div>Total: <span class="sale-item-total">${itemTotal.toFixed(2)}</span></div>
      </div>
      <button class="remove-item" data-index="${index}">×</button>
    `;
    container.appendChild(div);
  });

  const saleTotalElement = document.getElementById('saleTotal');
  if (saleTotalElement) saleTotalElement.value = subtotal.toFixed(2);

  container.querySelectorAll('.sale-unit-price').forEach(input => {
    input.addEventListener('change', e => {
      const idx = +e.target.dataset.index;
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) {
        e.target.value = currentSaleItems[idx].sellingPrice.toFixed(2);
        return;
      }
      currentSaleItems[idx].sellingPrice = val;
      currentSaleItems[idx].total = val * currentSaleItems[idx].quantity;
      updateSaleSummary();
    });
  });

  container.querySelectorAll('.sale-quantity').forEach(input => {
    input.addEventListener('change', e => {
      const idx = +e.target.dataset.index;
      let val = parseInt(e.target.value);
      if (isNaN(val) || val < 1) {
        e.target.value = currentSaleItems[idx].quantity;
        return;
      }
      currentSaleItems[idx].quantity = val;
      currentSaleItems[idx].total = currentSaleItems[idx].sellingPrice * val;
      updateSaleSummary();
    });
  });

  container.querySelectorAll('.remove-item').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.target.dataset.index;
      currentSaleItems.splice(idx, 1);
      updateSaleSummary();
    });
  });
}

// --- SALES FORM SUBMIT ---
function setupSalesForm() {
  const salesForm = document.getElementById('salesForm');
  if (!salesForm) {
    console.error('Sales form element not found!');
    return;
  }

  salesForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    try {
      if (currentSaleItems.length === 0) {
        alert('Please scan at least one item!');
        return;
      }

      const date = document.getElementById('saleDate').value; // stored for display only
      const clientName = document.getElementById('clientName').value.trim();
      const clientPhone = document.getElementById('clientPhone').value.trim();
      const saleType = document.getElementById('saleType')?.value || 'cash';
      const dueDate = document.getElementById('dueDate')?.value || '';
      let initialPayment = document.getElementById('initialPayment') ? parseFloat(document.getElementById('initialPayment').value) : 0;

      if (!date || !clientName) {
        alert('Please fill all required fields!');
        return;
      }

      if (saleType === 'credit') {
        if (!dueDate) {
          alert('Please provide a due date for credit sales.');
          return;
        }
        if (isNaN(initialPayment) || initialPayment < 0) {
          alert('Initial payment cannot be negative.');
          return;
        }
      } else {
        initialPayment = 0;
      }

      const batch = db.batch();
      const transactionId = db.collection('sales').doc().id;
      const stockRef = db.collection('stockmgt');

      // Validate inventory
      for (const item of currentSaleItems) {
        const productDoc = await stockRef.doc(item.id).get();
        const pdata = productDoc.data();
        const currentBarcodes = pdata.barcodes || [];

        const missingBarcodes = item.scannedBarcodes.filter(b => !currentBarcodes.includes(b));
        if (missingBarcodes.length > 0) {
          throw new Error(`Barcodes not found in product ${item.itemName}: ${missingBarcodes.join(', ')}`);
        }

        if ((pdata.stockQty || 0) < item.scannedBarcodes.length) {
          throw new Error(`Cannot complete sale: "${item.itemName}" only has ${pdata.stockQty} in stock!`);
        }
      }

      // Build writes
      for (const item of currentSaleItems) {
        const itemRef = stockRef.doc(item.id);
        const totalItemCost = (item.costPrice * item.quantity) + (item.shippingCost || 0);

        if (saleType === 'credit') {
          const creditSalesRef = db.collection('creditSales');
          const creditAmount = item.total;
          if (initialPayment > creditAmount) {
            throw new Error('Initial payment cannot exceed total credit amount.');
          }
          const balance = creditAmount - initialPayment;
          const newCreditSaleRef = creditSalesRef.doc();

          batch.set(newCreditSaleRef, {
            transactionId,
            date,
            clientName,
            clientPhone,
            scannedBarcodes: item.scannedBarcodes,
            itemName: item.itemName,
            quantity: item.quantity,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            shippingCost: item.shippingCost || 0,
            totalCost: totalItemCost,
            totalSale: item.total,
            creditAmount: creditAmount,
            amountPaid: initialPayment,
            balance: balance,
            dueDate,
            status: balance <= 0 ? 'Paid' : (initialPayment > 0 ? 'Partial' : 'Pending'),
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });

          if (balance <= 0) {
            const salesRef = db.collection('sales');
            const newSaleRef = salesRef.doc();
            batch.set(newSaleRef, {
              transactionId,
              date,
              clientName,
              clientPhone,
              scannedBarcodes: item.scannedBarcodes,
              itemName: item.itemName,
              quantity: item.quantity,
              costPrice: item.costPrice,
              sellingPrice: item.sellingPrice,
              shippingCost: item.shippingCost || 0,
              totalCost: totalItemCost,
              totalSale: item.total,
              saleType: 'credit-paid',
              category: item.category || '',
              timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
        } else {
          const salesRef = db.collection('sales');
          const newSaleRef = salesRef.doc();
          batch.set(newSaleRef, {
            transactionId,
            date,
            clientName,
            clientPhone,
            scannedBarcodes: item.scannedBarcodes,
            itemName: item.itemName,
            quantity: item.quantity,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            shippingCost: item.shippingCost || 0,
            totalCost: totalItemCost,
            totalSale: item.total,
            saleType: 'cash',
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
        }

        batch.update(itemRef, {
          stockQty: firebase.firestore.FieldValue.increment(-item.quantity),
          barcodes: firebase.firestore.FieldValue.arrayRemove(...item.scannedBarcodes)
        });
      }

      await completeSale(batch, saleType);
    } catch (error) {
      alert('Error processing sale: ' + error.message);
      console.error(error);
    }
  });
}

async function completeSale(batch, saleType) {
  await batch.commit();
  alert(saleType === 'credit' ? 'Credit sale recorded.' : 'Cash sale completed!');
  playSound('success');

  currentSaleItems = [];
  setupNewSale(); // ✅ reset duplicates for new transaction
  updateSaleSummary();
  document.getElementById('salesForm').reset();
  document.getElementById('saleDate').valueAsDate = new Date();
  document.getElementById('saleBarcode').focus();

  await loadProducts();
  await loadSalesRecords();
  await calculateProfit();
}

// --- INLINE EDIT (No Modal) ---
window.enableInlineEdit = async function (saleId) {
  const row = document.getElementById(`row-${saleId}`);
  if (!row) return;

  // Fetch latest sale doc to ensure we have costPrice/shippingCost for totals
  const saleDoc = await db.collection('sales').doc(saleId).get();
  if (!saleDoc.exists) {
    alert('Sale record not found!');
    return;
  }
  const sale = saleDoc.data();

  const cells = row.querySelectorAll('td');
  const original = Array.from(cells).map(td => td.innerText);

  // Editable fields: clientName (1), clientPhone (2), quantity (6), sellingPrice (7)
  cells[1].innerHTML = `<input type="text" class="form-control form-control-sm" id="editClientName-${saleId}" value="${sale.clientName || ''}">`;
  cells[2].innerHTML = `<input type="text" class="form-control form-control-sm" id="editClientPhone-${saleId}" value="${sale.clientPhone || ''}">`;
  cells[6].innerHTML = `<input type="number" class="form-control form-control-sm" id="editQty-${saleId}" min="1" value="${sale.quantity || 1}">`;
  cells[7].innerHTML = `<input type="number" step="0.01" min="0" class="form-control form-control-sm" id="editPrice-${saleId}" value="${(sale.sellingPrice || 0).toFixed(2)}">`;

  // Actions -> Save/Cancel
  cells[10].innerHTML = `
    <button class="btn btn-sm btn-success me-1" onclick="saveInlineEdit('${saleId}')">Save</button>
    <button class="btn btn-sm btn-secondary" onclick="cancelInlineEdit('${saleId}')">Cancel</button>
  `;

  // Store original for cancel in dataset
  row.dataset.original = JSON.stringify(original);
};

window.saveInlineEdit = async function (saleId) {
  try {
    const saleRef = db.collection('sales').doc(saleId);
    const existing = (await saleRef.get()).data();

    const quantity = parseInt(document.getElementById(`editQty-${saleId}`).value) || existing.quantity || 1;
    const sellingPrice = parseFloat(document.getElementById(`editPrice-${saleId}`).value) || existing.sellingPrice || 0;
    const clientName = document.getElementById(`editClientName-${saleId}`).value.trim();
    const clientPhone = document.getElementById(`editClientPhone-${saleId}`).value.trim();

    const costPrice = existing.costPrice || 0;
    const shippingCost = existing.shippingCost || 0;

    const updatedData = {
      clientName,
      clientPhone,
      quantity,
      sellingPrice,
      totalSale: sellingPrice * quantity,
      totalCost: costPrice * quantity + shippingCost,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!clientName) {
      alert('Client name is required.');
      return;
    }

    await saleRef.update(updatedData);

    // If it's a credit-related sale, optionally reflect to creditSales by transactionId
    if (existing.saleType?.includes('credit') && existing.transactionId) {
      const creditQuery = await db
        .collection('creditSales')
        .where('transactionId', '==', existing.transactionId)
        .limit(1)
        .get();
      if (!creditQuery.empty) {
        const creditDoc = creditQuery.docs[0];
        const amountPaid = creditDoc.data().amountPaid || 0;
        const balance = updatedData.totalSale - amountPaid;
        await creditDoc.ref.update({
          sellingPrice: updatedData.sellingPrice,
          totalSale: updatedData.totalSale,
          totalCost: updatedData.totalCost,
          balance: balance,
          status: balance <= 0 ? 'Paid' : (amountPaid > 0 ? 'Partial' : 'Pending'),
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    await loadSalesRecords();
    await calculateProfit();
    alert('Sale updated successfully!');
  } catch (error) {
    console.error('Error updating sale:', error);
    alert('Error updating sale: ' + error.message);
  }
};

window.cancelInlineEdit = function (saleId) {
  const row = document.getElementById(`row-${saleId}`);
  if (!row) return;
  const cells = row.querySelectorAll('td');
  const original = JSON.parse(row.dataset.original || '[]');
  if (original.length) {
    for (let i = 0; i < Math.min(cells.length, original.length); i++) {
      if (i === 10) continue; // actions cell handled below
      cells[i].innerText = original[i];
    }
  }
  // Restore action button
  cells[10].innerHTML = `<button class="btn btn-sm btn-primary edit-btn" data-id="${saleId}">Edit</button>`;
  cells[10].querySelector('button').addEventListener('click', () => enableInlineEdit(saleId));
};

// --- LOAD SALES RECORDS (uses `timestamp` for filters) ---
async function loadSalesRecords(filters = {}) {
  const tbody = document.getElementById('salesRecordsTableBody');
  tbody.innerHTML = '<tr><td colspan="11" class="text-center">Loading...</td></tr>';

  try {
    let query = db.collection('sales').orderBy('timestamp', 'desc');

    if (filters.fromDate) {
      const startDate = new Date(filters.fromDate);
      startDate.setHours(0, 0, 0, 0);
      query = query.where('timestamp', '>=', startDate);
    }

    if (filters.toDate) {
      const endDate = new Date(filters.toDate);
      endDate.setHours(23, 59, 59, 999);
      query = query.where('timestamp', '<=', endDate);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="11" class="text-center">No records found</td></tr>';
      return;
    }

    tbody.innerHTML = '';

    snapshot.docs.forEach(doc => {
      const sale = doc.data();

      if (filters.clientName && !sale.clientName?.toLowerCase().includes(filters.clientName.toLowerCase())) {
        return;
      }

      const tr = document.createElement('tr');
      tr.id = `row-${doc.id}`;
      tr.innerHTML = `
        <td>${formatDate(sale.timestamp)}</td>
        <td>${sale.clientName || ''}</td>
        <td>${sale.clientPhone || ''}</td>
        <td>${sale.itemName || ''}</td>
        <td>${sale.scannedBarcodes?.join(', ') || 'N/A'}</td>
        <td>${sale.category || ''}</td>
        <td>${sale.quantity || ''}</td>
        <td>${(sale.sellingPrice ?? '').toString() ? (sale.sellingPrice).toFixed(2) : ''}</td>
        <td>${(sale.totalCost ?? '').toString() ? (sale.totalCost).toFixed(2) : ''}</td>
        <td>${(sale.totalSale ?? '').toString() ? (sale.totalSale).toFixed(2) : ''}</td>
        <td>
          <button class="btn btn-sm btn-primary edit-btn" data-id="${doc.id}"><i class="bi bi-pencil"></i> Edit</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Add event listeners for edit buttons
    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const saleId = btn.dataset.id;
        enableInlineEdit(saleId);
      });
    });

    function formatDate(ts) {
      if (!ts) return '';
      const date = ts.toDate ? ts.toDate() : new Date(ts);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
  } catch (error) {
    console.error('Error loading sales:', error);
    tbody.innerHTML = '<tr><td colspan="11" class="text-center text-danger">Error loading records</td></tr>';
  }
}

// --- CALCULATE PROFIT (uses `timestamp`) ---
async function calculateProfit(filters = {}) {
  try {
    let query = db.collection('sales').orderBy('timestamp', 'desc');

    if (filters.fromDate) {
      const startDate = new Date(filters.fromDate);
      startDate.setHours(0, 0, 0, 0);
      query = query.where('timestamp', '>=', startDate);
    }

    if (filters.toDate) {
      const endDate = new Date(filters.toDate);
      endDate.setHours(23, 59, 59, 999);
      query = query.where('timestamp', '<=', endDate);
    }

    const salesSnap = await query.get();
    let totalSales = 0;
    let totalCost = 0;
    let totalShipping = 0;

    salesSnap.forEach(doc => {
      const sale = doc.data();
      const matchesClient = !filters.clientName || (sale.clientName && sale.clientName.toLowerCase().includes(filters.clientName.toLowerCase()));

      if ((!sale.saleType || sale.saleType === 'cash' || sale.saleType === 'credit-paid') && matchesClient) {
        totalSales += sale.totalSale || 0;
        totalCost += sale.totalCost || 0;
        totalShipping += sale.shippingCost || 0;
      }
    });

    const totalProfit = totalSales - totalCost;
    document.getElementById('totalSales').textContent = totalSales.toFixed(2);
    document.getElementById('totalCost').textContent = totalCost.toFixed(2);
    document.getElementById('shippingCostTotal').textContent = totalShipping.toFixed(2);
    const profitEl = document.getElementById('profit');
    profitEl.textContent = totalProfit.toFixed(2);
    profitEl.style.color = totalProfit >= 0 ? 'green' : 'red';
  } catch (error) {
    console.error('Error calculating profit:', error);
    alert('Error calculating profit. Check console for details.');
  }
}

// --- UTILITY FUNCTIONS ---
function playSound(type) {
  try {
    const audio = new Audio();
    audio.src = type === 'success'
      ? 'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3'
      : 'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
    audio.play().catch(e => console.log('Audio playback failed:', e));
  } catch (e) {
    console.log('Sound error:', e);
  }
}

// --- ON LOAD ---
window.onload = () => {
  document.getElementById('saleBarcode')?.focus();
  setupNewSale();
  loadSalesRecords();
  calculateProfit();
};
