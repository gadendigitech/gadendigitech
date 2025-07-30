// --- FIREBASE INITIALIZATION ---
if (!firebase.apps.length) {
  firebase.initializeApp({
    apiKey: "AIzaSyD2WZnOuDXBLXR7uAq_LTK46q7tr13Mqvw",
    authDomain: "gadendigitech.firebaseapp.com",
    projectId: "gadendigitech",
    storageBucket: "gadendigitech.firebasestorage.app",
    messagingSenderId: "134032321432",
    appId: "1:134032321432:web:dedbb18980661259ed",
    measurementId: "G-VLG9G3FCP0"
  });
}
const auth = firebase.auth();
const db = firebase.firestore();
window.db = db;

let products = [];
let currentSaleItems = [];
let barcodeInputBuffer = '';
let currentEditingSale = null;
let barcodeTimeout;
const BARCODE_DELAY = 50;

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
// Modify your initializeApp function to ensure products are loaded first
async function initializeApp() {
  try {
    await loadProducts(); // Wait for products to load first
    
    setupFilterButtons();
    setupClearFilterButtons();
    setupSaleTypeToggle();
    setupBarcodeScanner();
    setupSalesForm();
    loadSalesRecords();
    calculateProfit();
    
    const saleDateEl = document.getElementById('saleDate');
    if (saleDateEl) saleDateEl.valueAsDate = new Date();
    
    const barcodeInput = document.getElementById('saleBarcode');
    if (barcodeInput) {
      barcodeInput.focus();
      barcodeInput.value = ''; // Clear any existing value
    }
    
    const saveEditBtn = document.getElementById('saveEditSaleBtn');
    if (saveEditBtn) saveEditBtn.addEventListener('click', saveEditedSale);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => auth.signOut());
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
      // Set default due date to 7 days from now
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);
      document.getElementById('dueDate').valueAsDate = dueDate;
      document.getElementById('initialPayment').value = '0';
    } else {
      creditFields.style.display = 'none';
    }
  }
  
  saleTypeSelect.addEventListener('change', toggleCreditFields);
  toggleCreditFields(); // Initialize
}

// --- FILTER BUTTONS ---
function setupFilterButtons() {
  const filterButton = document.getElementById('filterSalesButton');
  if (filterButton) {
    filterButton.addEventListener('click', function() {
       loadSalesRecords();
       calculateProfit();
    });
  }
}

function setupClearFilterButtons() {
  const clearBtn = document.getElementById('clearSalesFilterButton');
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
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
        barcodes: Array.isArray(data.barcodes) ? data.barcodes : []
      };
    });
    console.log(`Loaded ${products.length} products`);
  } catch (error) {
    console.error('Failed to load products:', error);
    alert('Failed to load product inventory. Please refresh the page.');
    products = []; // Reset to empty array
  }
}
  // --- BARCODE SCANNING ---
function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('saleBarcode');
  
  if (!barcodeInput) {
    console.error('Barcode input element not found!');
    return;
  }

  let isScannerInput = false;
  let lastInputTime = 0;
  const SCANNER_TIMEOUT = 50; // ms between keypresses to detect scanner

  barcodeInput.addEventListener('keydown', async (e) => {
    const input = e.target.value.trim();
    const now = Date.now();
    const isFastInput = (now - lastInputTime) < SCANNER_TIMEOUT;
    lastInputTime = now;

    // Detect scanner input (fast input)
    if (input.length > 0 && isFastInput) {
      isScannerInput = true;
      return; // Wait for full barcode
    }

    // Process manual input (slow typing)
    if (!isScannerInput && input.length >= 6) {
      await handleManualInput(input.slice(-6)); // Use last 6 digits
      e.target.value = '';
      return;
    }

    // Process scanner input
    if (isScannerInput && input.length > 0) {
      await processScannedBarcode(input);
      e.target.value = '';
      isScannerInput = false;
    }
  });

  // Fallback for scanners that send Enter key
  barcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      isScannerInput = true;
      barcodeInput.dispatchEvent(new Event('input')); // Trigger input event
    }
  });

  barcodeInput.focus();
}

async function handleManualInput(last6Digits) {
  // 1. Check local products first
  const localMatch = products.find(p => 
    p.barcodes?.some(bc => bc.endsWith(last6Digits))
  );
  
  if (localMatch) {
    const fullBarcode = localMatch.barcodes.find(bc => bc.endsWith(last6Digits));
    await addProductToSale(localMatch, fullBarcode);
    } else {
    alert('No product matches the last 6 digits entered');
    playSound('error');
  }
}


// --- PROCESS FULL BARCODE SCANNING ---
async function processScannedBarcode(fullBarcode) {
  try {
    // Search local products first
    let product = products.find(p => p.barcodes?.includes(fullBarcode));

    // If not found, query Firestore by full barcode (array-contains)
    if (!product) {
      const snapshot = await db.collection('stockmgt')
        .where('barcodes', 'array-contains', fullBarcode)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        product = { id: doc.id, ...doc.data() };
        // Add to local cache for future
        products.push(product);
      }
    }

    if (product) {
      // Before adding, you might refresh product stockQty from Firestore here if you want real-time accuracy
      await addProductToSale(product, fullBarcode);
    } else {
      alert(`Product with barcode ${fullBarcode} not found!`);
      playSound('error');
    }
  } catch (error) {
    console.error('Barcode processing error:', error);
    alert('Error processing barcode. Please try again.');
  }
}

async function addProductToSale(product, barcode) {
  if (!product || !barcode) return;

  // Check if already scanned
  if (currentSaleItems.some(item => item.scannedBarcodes.includes(barcode))) {
    alert(`Product "${product.itemName}" already scanned!`);
    playSound('error');
    return;
  }

  // Check stock
  if ((product.stockQty || 0) <= 0) {
    alert(`Product "${product.itemName}" is out of stock!`);
    playSound('error');
    return;
  }

  // Add to sale with all product details
  const existingIndex = currentSaleItems.findIndex(item => item.id === product.id);
  
  if (existingIndex >= 0) {
    // Update existing item
    currentSaleItems[existingIndex].scannedBarcodes.push(barcode);
    currentSaleItems[existingIndex].total += product.sellingPrice;
  } else {
    // Add new item with complete product information
    currentSaleItems.push({
      id: product.id,
      itemName: product.itemName,
      sellingPrice: product.sellingPrice,
      costPrice: product.costPrice,
      category: product.category,
      stockQty: product.stockQty,
      barcodes: product.barcodes,
      scannedBarcodes: [barcode],
      total: product.sellingPrice
    });
  }

  updateSaleSummary();
  playSound('success');
  
  // Return focus
  const barcodeInput = document.getElementById('saleBarcode');
  if (barcodeInput) barcodeInput.focus();
}

// --- SALE SUMMARY ---
function updateSaleSummary() {
  const container = document.getElementById('saleItemsContainer');
  container.innerHTML = '';
  
  let subtotal = 0;
  

  currentSaleItems.forEach((item, index) => {
    const quantity = item.scannedBarcodes.length;
    subtotal += item.total;
    if (item.shippingCost) {
      totalShipping += item.shippingCost;
    }
    
    const div = document.createElement('div');
    div.className = 'sale-item';
    div.innerHTML = `
      <span>${item.itemName} (${quantity} pcs)</span>
      <input 
        type="number" 
        class="sale-unit-price" 
        data-index="${index}" 
        value="${item.sellingPrice.toFixed(2)}" 
        min="0" step="0.01" 
        style="width: 70px;"
      />
      <span>Barcodes: ${item.scannedBarcodes.slice(0, 3).join(', ')}${item.scannedBarcodes.length > 3 ? '...' : ''}</span>
     
        data-index="${index}" 
        value="${item.total.toFixed(2)}" 
        min="0" step="0.01" 
        style="width: 80px;"
      /></span>
      <button class="remove-item" data-index="${index}">×</button>
    `;
    container.appendChild(div);
  });

  document.querySelectorAll('.sale-unit-price').forEach(input => {
    input.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      const newUnitPrice = parseFloat(e.target.value);
      if (!isNaN(newUnitPrice) && newUnitPrice >= 0) {
        currentSaleItems[index].sellingPrice = newUnitPrice;
        currentSaleItems[index].total = newUnitPrice * currentSaleItems[index].scannedBarcodes.length;
        updateSaleSummary();
      } else {
        e.target.value = currentSaleItems[index].sellingPrice.toFixed(2);
      }
    });
  });

  document.querySelectorAll('.sale-item-total').forEach(input => {
    input.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      const newTotal = parseFloat(e.target.value);
      if (!isNaN(newTotal) && newTotal >= 0) {
        currentSaleItems[index].total = newTotal;
        const quantity = currentSaleItems[index].scannedBarcodes.length;
        if (quantity > 0) {
          currentSaleItems[index].sellingPrice = newTotal / quantity;
        }
        updateSaleSummary();
      } else {
        e.target.value = currentSaleItems[index].total.toFixed(2);
      }
    });
  });

  document.querySelectorAll('.remove-item').forEach(button => {
    button.addEventListener('click', e => {
      const index = parseInt(e.target.dataset.index);
      currentSaleItems.splice(index, 1);
      updateSaleSummary();
    });
  });

  document.getElementById('saleTotal').value = subtotal.toFixed(2);
}

// --- STOCK & BARCODE SYNCHRONIZATION ---
async function synchronizeStockAfterSale(currentSaleItems) {
  for (const item of currentSaleItems) {
    const doc = await db.collection('stockmgt').doc(item.id).get();
    const data = doc.data();
    const barcodesCount = (data.barcodes || []).length;
    if ((data.stockQty || 0) !== barcodesCount) {
      await db.collection('stockmgt').doc(item.id).update({
        stockQty: barcodesCount
      });
    }
    if ((data.stockQty || 0) < 0) {
      await db.collection('stockmgt').doc(item.id).update({ stockQty: 0 });
    }
  }
}

// --- SALES FORM SUBMIT: Unified Cash & Credit + Stock Sync ---
function setupSalesForm() {
  document.getElementById('salesForm').addEventListener('submit', async e => {
    e.preventDefault();

    if (currentSaleItems.length === 0) {
      alert('Please scan at least one item!');
      return;
    }

    // Gather form data as before ...
    const date = document.getElementById('saleDate').value;
    const clientName = document.getElementById('clientName').value.trim();
    const clientPhone = document.getElementById('clientPhone').value.trim();
    const saleType = document.getElementById('saleType')?.value || "cash";
    const dueDate = document.getElementById('dueDate')?.value || "";
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

    try {
      const batch = db.batch();
      const transactionId = db.collection('sales').doc().id;
      const stockRef = db.collection('stockmgt');

      for (const item of currentSaleItems) {
        const productDoc = await stockRef.doc(item.id).get();
        const currentBarcodes = productDoc.data().barcodes || [];
        
        const missingBarcodes = item.scannedBarcodes.filter(b => !currentBarcodes.includes(b));
        if (missingBarcodes.length > 0) {
          throw new Error(`Barcodes not found in product ${item.itemName}: ${missingBarcodes.join(', ')}`);
        }

        if ((productDoc.data().stockQty || 0) < item.scannedBarcodes.length) {
          throw new Error(`Cannot complete sale: "${item.itemName}" only has ${productDoc.data().stockQty} in stock!`);
        }
      }

      for (const item of currentSaleItems) {
        const itemRef = stockRef.doc(item.id);
        const totalItemCost = (item.costPrice * item.scannedBarcodes.length) + (item.shippingCost || 0);

        if (saleType === 'credit') {
          const creditSalesRef = db.collection('creditSales');
          const creditAmount = item.total;
          if (initialPayment > creditAmount) {
            throw new Error('Initial payment cannot exceed total credit amount.');
          }
          const balance = creditAmount - initialPayment;
          const newCreditSaleRef = creditSalesRef.doc();

          // Always add to creditSales
          batch.set(newCreditSaleRef, {
            transactionId,
            date,
            clientName,
            clientPhone,
            scannedBarcode: item.scannedBarcodes[0],
            itemName: item.itemName,
            quantity: item.scannedBarcodes.length,
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

          // Only add to sales collection if fully paid
          if (balance <= 0) {
            const salesRef = db.collection('sales');
            const newSaleRef = salesRef.doc();
            batch.set(newSaleRef, {
              transactionId,
              date,
              clientName,
              clientPhone,
              scannedBarcode: item.scannedBarcodes[0],
              itemName: item.itemName,
              quantity: item.scannedBarcodes.length,
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
            scannedBarcode: item.scannedBarcodes[0],
            itemName: item.itemName,
            quantity: item.scannedBarcodes.length,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            shippingCost: item.shippingCost || 0,
            totalCost: totalItemCost,
            totalSale: item.total,
            saleType: "cash",
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
        }

        batch.update(itemRef, {
          stockQty: firebase.firestore.FieldValue.increment(-item.scannedBarcodes.length),
          barcodes: firebase.firestore.FieldValue.arrayRemove(...item.scannedBarcodes)
        });
      }

      await batch.commit();
      alert(saleType === 'credit' ? 'Credit sale recorded.' : 'Cash sale completed!');
      playSound('success');
      currentSaleItems = [];
      updateSaleSummary();
      document.getElementById('salesForm').reset();
      document.getElementById('saleDate').valueAsDate = new Date();
      document.getElementById('saleBarcode').focus();
      loadProducts();
      loadSalesRecords();
      calculateProfit();
    } catch (error) {
      alert('Error processing sale: ' + error.message);
      console.error(error);
    }
  });
}


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
// --- EDIT SALE FUNCTIONALITY ---
window.editSale = async function(saleId) {
  try {
    document.getElementById('editSaleForm').reset();
    
    const saleDoc = await db.collection('sales').doc(saleId).get();
    if (!saleDoc.exists) {
      throw new Error('Sale record not found!');
    }
    
    const saleData = saleDoc.data();
    currentEditingSale = { id: saleId, ...saleData };
    
    document.getElementById('editSaleId').value = saleId;
    document.getElementById('editSaleDate').value = saleData.date || '';
    document.getElementById('editClientName').value = saleData.clientName || '';
    document.getElementById('editClientPhone').value = saleData.clientPhone || '';
    document.getElementById('editItemName').value = saleData.itemName || '';
    document.getElementById('editQuantity').value = saleData.quantity || 1;
    document.getElementById('editSellingPrice').value = saleData.sellingPrice?.toFixed(2) || '';
    document.getElementById('editCostPrice').value = saleData.costPrice?.toFixed(2) || '';
    document.getElementById('editShippingCost').value = saleData.shippingCost?.toFixed(2) || 0;
    
  } catch (error) {
    console.error("Error preparing edit:", error);
    alert('Error loading sale for editing: ' + error.message);
  }
};
async function saveEditedSale() {
  if (!currentEditingSale) return;
  
  try {
    const form = document.getElementById('editSaleForm');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    
    const quantity = parseInt(document.getElementById('editQuantity').value) || 1;
    const sellingPrice = parseFloat(document.getElementById('editSellingPrice').value) || 0;
    const shippingCost = parseFloat(document.getElementById('editShippingCost').value) || 0;
    
    const updatedData = {
      date: document.getElementById('editSaleDate').value,
      clientName: document.getElementById('editClientName').value.trim(),
      clientPhone: document.getElementById('editClientPhone').value.trim(),
      quantity: quantity,
      sellingPrice: sellingPrice,
      shippingCost: shippingCost,
      totalSale: sellingPrice * quantity,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!updatedData.date || !updatedData.clientName) {
      alert('Please fill in all required fields!');
      return;
    }

    await db.collection('sales').doc(currentEditingSale.id).update(updatedData);
    
    if (currentEditingSale.saleType?.includes('credit')) {
      await updateCreditSaleRecord(currentEditingSale.transactionId, updatedData);
    }

    currentEditingSale = null;
    loadSalesRecords();
    calculateProfit();
    alert('Sale updated successfully!');
    
  } catch (error) {
    console.error("Error updating sale:", error);
    alert('Error updating sale: ' + error.message);
  }
}

async function updateCreditSaleRecord(transactionId, updatedData) {
  const creditQuery = await db.collection('creditSales')
    .where('transactionId', '==', transactionId)
    .limit(1)
    .get();
  
  if (!creditQuery.empty) {
    const creditDoc = creditQuery.docs[0];
    await creditDoc.ref.update({
      sellingPrice: updatedData.sellingPrice,
      totalSale: updatedData.totalSale,
      balance: updatedData.totalSale - (creditDoc.data().amountPaid || 0)
    });
  }
}

// --- LOAD SALES RECORDS ---
async function loadSalesRecords() {
  const tbody = document.getElementById('salesRecordsTableBody');
  const fromDate = document.getElementById('filterSalesFromDate')?.value;
  const toDate = document.getElementById('filterSalesToDate')?.value;
  const nameFilter = document.getElementById('filterSalesClientName')?.value.trim().toLowerCase();

  tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading...</td></tr>';

  try {
    console.log("Loading sales records with filters:", { fromDate, toDate, nameFilter });

    let query = db.collection('sales').orderBy('timestamp', 'desc');

    if (fromDate && toDate) {
      const startDate = new Date(fromDate);
      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1);
      query = query.where('timestamp', '>=', startDate)
                   .where('timestamp', '<=', endDate);
    } else if (fromDate) {
      const startDate = new Date(fromDate);
      query = query.where('timestamp', '>=', startDate);
    } else if (toDate) {
      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1);
      query = query.where('timestamp', '<=', endDate);
    }

    const snapshot = await query.get();
    console.log(`Fetched ${snapshot.size} sales records`);

    tbody.innerHTML = '';

    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center">No records found</td></tr>';
      return;
    }

    snapshot.forEach(doc => {
      const sale = doc.data();
      const isEditing = currentEditingSale?.id === doc.id;

      const tr = document.createElement('tr');

      if (isEditing) {
        tr.innerHTML = `
          <td><input type="date" value="${sale.date || ''}" class="edit-field" id="editDate"></td>
          <td><input type="text" value="${sale.clientName || ''}" class="edit-field" id="editClientName"></td>
          <td><input type="text" value="${sale.clientPhone || ''}" class="edit-field" id="editClientPhone"></td>
          <td>${sale.itemName || ''}</td>
          <td>${sale.scannedBarcode || 'N/A'}</td>
          <td>${sale.category || ''}</td>
          <td><input type="number" value="${sale.quantity || 1}" class="edit-field" id="editQuantity"></td>
          <td><input type="number" step="0.01" value="${sale.sellingPrice || 0}" class="edit-field" id="editSellingPrice"></td>
          <td><input type="number" step="0.01" value="${sale.totalSale || 0}" class="edit-field" id="editTotalSale"></td>
          <td>
            <button class="btn btn-sm btn-success save-edit-btn" data-id="${doc.id}">Save</button>
            <button class="btn btn-sm btn-secondary cancel-edit-btn">Cancel</button>
          </td>
        `;
      } else {
        tr.innerHTML = `
          <td>${sale.date || ''}</td>
          <td>${sale.clientName || ''}</td>
          <td>${sale.clientPhone || ''}</td>
          <td>${sale.itemName || ''}</td>
          <td>${sale.scannedBarcode || 'N/A'}</td>
          <td>${sale.category || ''}</td>
          <td>${sale.quantity || ''}</td>
          <td>${sale.sellingPrice?.toFixed(2) || ''}</td>
          <td>${sale.totalSale?.toFixed(2) || ''}</td>
          <td>
            <button class="btn btn-sm btn-primary edit-btn" data-id="${doc.id}">
              <i class="bi bi-pencil"></i> Edit
            </button>
          </td>
        `;
      }

      tbody.appendChild(tr); // Always append the row
    });

    // Setup event listeners for the dynamically created buttons

    // Edit buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        currentEditingSale = { id };
        loadSalesRecords();
      });
    });

    // Save edit buttons
    document.querySelectorAll('.save-edit-btn').forEach(btn => {
      btn.addEventListener('click', saveEditedSale);
    });

    // Cancel edit buttons
    document.querySelectorAll('.cancel-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentEditingSale = null;
        loadSalesRecords();
      });
    });

  } catch (error) {
    console.error("Error loading sales:", error);
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading records</td></tr>';
  }
}

// --- GROUP RECEIPT (SALES ONLY) ---
function gatherSalesForGroupReceipt(clientName, date) {
  return db.collection('sales')
    .where('clientName', '==', clientName)
    .where('date', '==', date)
    .get()
    .then(snapshot => {
      const items = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        items.push({
          itemName: d.itemName,
          category: d.category,
          barcode: d.scannedBarcode,
          quantity: d.quantity,
          sellingPrice: d.sellingPrice
        });
      });
      return items;
    });
}

document.getElementById('groupReceiptForm').onsubmit = async function(e) {
  e.preventDefault();
  const client = document.getElementById('receipt-client').value.trim();
  const date = document.getElementById('receipt-date').value;
  if (!client || !date) {
    alert('Provide client name and date.');
    return;
  }
  const items = await gatherSalesForGroupReceipt(client, date);
  if (!items.length) {
    alert('No sales records for that client and date.');
    return;
  }
  generateGroupReceipt({
    id: client + '-' + date,
    date: date,
    clientName: client,
    items: items,
    servedBy: auth.currentUser?.email || 'System'
  });
};

function generateGroupReceipt(sale) {
  if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) {
    alert('No valid sale data provided for receipt.');
    return;
  }
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };
  const formatCurrency = (amount) => Number(amount).toFixed(2);
  let subtotal = 0;
  const itemsBody = [['Item', 'Cat', 'Barcode', 'Qty', 'Price']];
  const trim = (str, n) => str && str.length > n ? str.slice(0, n) + '...' : (str || '');
  sale.items.forEach(item => {
    const price = item.sellingPrice || item.price || 0;
    const quantity = item.quantity || 1;
    subtotal += price * quantity;
    itemsBody.push([
      { text: trim(item.itemName, 12), fontSize: 7, margin: [0, 2, 0, 2] },
      { text: trim(item.category, 7), fontSize: 7, margin: [0, 2, 0, 2] },
      { text: trim(item.barcode, 8), fontSize: 7, margin: [0, 2, 0, 2], noWrap: false },
      { text: quantity.toString(), fontSize: 7, alignment: 'center', margin: [0, 2, 0, 2] },
      { text: formatCurrency(price), fontSize: 7, alignment: 'right', margin: [0, 2, 0, 2] }
    ]);
  });
  const vat = subtotal * 0.16;
  const total = subtotal + vat;
  const cash = total;
  const change = 0;
  const docDefinition = {
    pageSize: { width: 227, height: 'auto' },
    pageMargins: [10, 10, 10, 10],
    content: [
      { text: 'Gaden Digitech Ltd', style: 'header' },
      { text: 'Paybill: 700201 | Acc:400103', style: 'subheader' },
      { text: 'gadendigitech@gmail.com', style: 'subheader' },
      { text: `Receipt: ${sale.id || ''}`, style: 'small' },
      { text: `Date: ${formatDate(sale.date)}`, style: 'small' },
      { text: `Client: ${sale.clientName || ''}`, style: 'small' },
      { text: '\n' },
      {
        table: {
          widths: [55, 32, '*', 16, 32],
          body: itemsBody
        },
        layout: 'lightHorizontalLines'
      },
      { text: '\n' },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            ['Subtotal', formatCurrency(subtotal)],
            ['VAT (16%)', formatCurrency(vat)],
            [{ text: 'TOTAL', bold: true }, { text: formatCurrency(total), bold: true }],
            ['Cash', formatCurrency(cash)],
            ['Change', formatCurrency(change)]
          ]
        },
        layout: 'noBorders'
      },
      { text: '\n' },
      { text: 'Goods sold are not returnable.', style: 'note' },
      { text: 'Served by: ' + (sale.servedBy || 'System'), style: 'note' }
    ],
    styles: {
      header: { fontSize: 12, bold: true, alignment: 'center', margin: [0, 0, 0, 8] },
      subheader: { fontSize: 8, alignment: 'center' },
      small: { fontSize: 8, alignment: 'center' },
      note: { fontSize: 7, italics: true, alignment: 'center' }
    },
    defaultStyle: { fontSize: 8 }
  };
  pdfMake.createPdf(docDefinition).print();
}

// --- CALCULATE PROFIT ---// --- CALCULATE PROFIT ---
async function calculateProfit() {
  const fromDate = document.getElementById('filterSalesFromDate')?.value;
  const toDate = document.getElementById('filterSalesToDate')?.value;
  const nameFilter = document.getElementById('filterSalesClientName')?.value.trim().toLowerCase();

  try {
    let query = db.collection('sales').orderBy('timestamp', 'desc');
    
    if (fromDate && toDate) {
      const startDate = new Date(fromDate);
      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1);
      query = query.where('timestamp', '>=', startDate)
                   .where('timestamp', '<=', endDate);
    } else if (fromDate) {
      const startDate = new Date(fromDate);
      query = query.where('timestamp', '>=', startDate);
    } else if (toDate) {
      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1);
      query = query.where('timestamp', '<=', endDate);
    }

    const salesSnap = await query.get();
    let totalSales = 0;
    let totalCost = 0;
    let totalShipping = 0;

    salesSnap.forEach(doc => {
      const sale = doc.data();
      const matchesClient = !nameFilter || 
                          (sale.clientName && sale.clientName.toLowerCase().includes(nameFilter));
      
      if ((!sale.saleType || sale.saleType === "cash" || sale.saleType === "credit-paid") && matchesClient) {
        totalSales += sale.totalSale || 0;
        totalCost += sale.totalCost || 0;
        totalShipping += sale.shippingCost || 0;
      }
    });

    const totalProfit = totalSales - totalCost;
    document.getElementById('totalSales').textContent = totalSales.toFixed(2);
    document.getElementById('totalCost').textContent = totalCost.toFixed(2);
    document.getElementById('shippingCostTotal').textContent = totalShipping.toFixed(2);
    document.getElementById('profit').textContent = totalProfit.toFixed(2);
    const profitElement = document.getElementById('profit');
    profitElement.style.color = totalProfit >= 0 ? 'green' : 'red';
  } catch (error) {
    console.error("Error calculating profit:", error);
    alert('Error calculating profit. Check console for details.');
  }
}

// --- UTILITY FUNCTIONS ---
function playSound(type) {
  const audio = new Audio();
  audio.src = type === 'success'
    ? 'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3'
    : 'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
  audio.play();
}

// --- ON LOAD ---
window.onload = () => {
  document.getElementById('saleBarcode')?.focus();
  loadSalesRecords();
  calculateProfit();
};
