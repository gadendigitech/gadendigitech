// --- GLOBAL CONSTANTS ---
if (typeof window.BARCODE_DELAY === 'undefined') {
    window.BARCODE_DELAY = 100; // ms between keystrokes
}
if (typeof window.MANUAL_DIGITS === 'undefined') {
    window.MANUAL_DIGITS = 6;   // Manual entry digits
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
    
    // Set focus and clear input
    const barcodeInput = document.getElementById('saleBarcode');
    if (barcodeInput) {
      barcodeInput.focus();
      barcodeInput.value = '';
    }
    
    // Set current date
    const saleDateEl = document.getElementById('saleDate');
    if (saleDateEl) saleDateEl.valueAsDate = new Date();
    
    // Setup event listeners
    document.getElementById('saveEditSaleBtn')?.addEventListener('click', saveEditedSale);
    document.getElementById('logoutBtn')?.addEventListener('click', () => auth.signOut());
    
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
// --- BARCODE SCANNING SYSTEM ---

function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('saleBarcode');
  if (!barcodeInput) {
    console.error('Barcode input element not found!');
    return;
  }

  // Clear previous listeners to avoid duplicates
  barcodeInput.removeEventListener('input', handleBarcodeInput);
  barcodeInput.removeEventListener('keydown', handleBarcodeKeydown);

  // Add fresh listeners
  barcodeInput.addEventListener('input', handleBarcodeInput);
  barcodeInput.addEventListener('keydown', handleBarcodeKeydown);
  barcodeInput.focus();
} 
  let barcodeInputTimeout;

function handleBarcodeInput(e) {
  clearTimeout(barcodeInputTimeout);
  const input = e.target.value.trim();
  
  // Scanner detection (fast input of full barcode)
  if (input.length >= 8) { // Most barcodes are 8+ digits
    barcodeInputTimeout = setTimeout(() => {
      processScannedBarcode(input);
      e.target.value = '';
    }, BARCODE_DELAY);
  }
  // Manual entry detection (exactly 6 digits)
  else if (input.length === MANUAL_DIGITS) {
    barcodeInputTimeout = setTimeout(() => {
      handleManualInput(input);
      e.target.value = '';
    }, BARCODE_DELAY);
  }
}

function handleBarcodeKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = e.target.value.trim();
    
    // Determine if this is manual or scanner input
    if (input.length === MANUAL_DIGITS) {
      handleManualInput(input);
    } else if (input.length >= 8) {
      processScannedBarcode(input);
    }
    
    e.target.value = '';
  }
}

async function handleManualInput(last6Digits) {
  if (!last6Digits || last6Digits.length !== MANUAL_DIGITS) {
    alert('Please enter exactly 6 digits');
    return;
  }

  try {
    // Find product with matching last 6 digits
    const matchingProducts = products.filter(p => 
      Array.isArray(p.barcodes) && 
      p.barcodes.some(bc => bc.endsWith(last6Digits))
    );

    if (matchingProducts.length === 1) {
      const fullBarcode = matchingProducts[0].barcodes.find(bc => 
        bc.endsWith(last6Digits)
      );
      await addProductToSale(matchingProducts[0], fullBarcode);
    } 
    else if (matchingProducts.length > 1) {
      alert(`Multiple products match last 6 digits. Please scan full barcode.`);
      playSound('error');
    }
    else {
      // If not found locally, try Firestore lookup
      const snapshot = await db.collection('stockmgt')
        .where('barcodes', 'array-contains-any', 
          Array.from({length: 10}, (_,i) => `${i}${last6Digits}`) // Generate possible matches
        )
        .limit(2) // We only care if there's 0, 1, or multiple matches
        .get();

      if (snapshot.size === 1) {
        const doc = snapshot.docs[0];
        const product = { id: doc.id, ...doc.data() };
        const fullBarcode = product.barcodes.find(bc => 
          bc.endsWith(last6Digits)
        );
        await addProductToSale(product, fullBarcode);
      }
      else if (snapshot.size > 1) {
        alert(`Multiple products match last 6 digits. Please scan full barcode.`);
        playSound('error');
      }
      else {
        alert(`No product found with matching last 6 digits: ${last6Digits}`);
        playSound('error');
      }
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
    // First check local products array
    let product = products.find(p => 
      Array.isArray(p.barcodes) && p.barcodes.includes(fullBarcode)
    );

    // If not found locally, query Firestore
    if (!product) {
      const snapshot = await db.collection('stockmgt')
        .where('barcodes', 'array-contains', fullBarcode)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        product = { id: doc.id, ...doc.data() };
        products.push(product); // Cache for future lookups
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

  try {
    // Check if this exact barcode was already scanned
    const isDuplicate = currentSaleItems.some(item => 
      item.scannedBarcodes.includes(barcode)
    );
    
    if (isDuplicate) {
      alert(`Barcode ${barcode} was already scanned!`);
      playSound('error');
      return;
    }

    // Verify inventory
    const productDoc = await db.collection('stockmgt').doc(product.id).get();
    const productData = productDoc.data();
    
    if (!productData.barcodes?.includes(barcode)) {
      alert(`Barcode ${barcode} not found in inventory!`);
      playSound('error');
      return;
    }

    // Check if product already exists in sale
    const existingIndex = currentSaleItems.findIndex(item => item.id === product.id);

    if (existingIndex >= 0) {
      // Product exists - just add the barcode (but don't increase quantity)
      currentSaleItems[existingIndex].scannedBarcodes.push(barcode);
    } else {
      // New product - add with quantity 1
      currentSaleItems.push({
        id: product.id,
        itemName: product.itemName,
        sellingPrice: product.sellingPrice,
        costPrice: product.costPrice,
        category: product.category,
        stockQty: productData.stockQty,
        scannedBarcodes: [barcode],
        quantity: 1, // Explicitly set to 1
        total: product.sellingPrice
      });
    }

    updateSaleSummary();
    playSound('success');
    document.getElementById('saleBarcode').focus();

  } catch (error) {
    console.error("Error adding product:", error);
    alert("Error processing product. Please try again.");
    playSound('error');
  }
}
// Helper function for consistent alerts
function showAlert(message, type) {
  alert(message);
  playSound(type || 'error');
}
// --- SALE SUMMARY ---
function updateSaleSummary() {
  const container = document.getElementById('saleItemsContainer');
  if (!container) return;
  
  container.innerHTML = '';
  let subtotal = 0;

currentSaleItems.forEach(item => {
    // Use the explicit quantity instead of scannedBarcodes.length
    const quantity = item.quantity; // THIS IS CRITICAL
    const itemTotal = item.sellingPrice * quantity;
    subtotal += itemTotal;

    const div = document.createElement('div');
    div.className = 'sale-item';
    div.innerHTML = `
      <div class="product-info">
        <strong>${item.itemName}</strong>
        <div>Category: ${item.category}</div>
        <div>Barcode: ${item.scannedBarcodes[0]}</div>
      </div>
      <div class="price-info">
        <div>Price: <input
                         type="number"
                         class="sale-unit-price"
                         data-index="${index}"
                         value="${item.sellingPrice.toFixed(2)}"
                         min="0" step="0.01"
                         style="width: 70px;"
                       />
        </div>
        <div>Qty: ${quantity}</div>
        <div>Total: <input
                        type="number"
                        class="sale-item-total"
                        data-index="${index}"
                        value="${item.total.toFixed(2)}"
                        min="0" step="0.01"
                        style="width: 80px;"
                      />
        </div>
      </div>
      <button class="remove-item" data-index="${index}">×</button>
    `;
    container.appendChild(div);
  });

  const saleTotalElement = document.getElementById('saleTotal');
  if (saleTotalElement) {
    saleTotalElement.value = subtotal.toFixed(2);
  }
  // Event listeners for price/unit changes
  container.querySelectorAll('.sale-unit-price').forEach(input => {
    input.addEventListener('change', e => {
      const idx = +e.target.dataset.index;
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) {
        e.target.value = currentSaleItems[idx].sellingPrice.toFixed(2);
        return;
      }
      currentSaleItems[idx].sellingPrice = val;
      let qty = currentSaleItems[idx].scannedBarcodes.length;
      currentSaleItems[idx].total = val * qty;
      updateSaleSummary();
    });
  });

  container.querySelectorAll('.sale-item-total').forEach(input => {
    input.addEventListener('change', e => {
      const idx = +e.target.dataset.index;
      let val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) {
        e.target.value = currentSaleItems[idx].total.toFixed(2);
        return;
      }
      currentSaleItems[idx].total = val;
      const qty = currentSaleItems[idx].scannedBarcodes.length;
      if (qty > 0) {
        currentSaleItems[idx].sellingPrice = val / qty;
      }
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
  const salesForm = document.getElementById('salesForm');
  if (!salesForm) {
    console.error('Sales form element not found!');
    return;
  }

  salesForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    try {
      // Validate inputs
      if (currentSaleItems.length === 0) {
        alert('Please scan at least one item!');
        return;
      
    }

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
            saleType: balance <= 0 ? 'credit-paid' : 'credit',
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
      
      await loadProducts();
      await loadSalesRecords();
      await calculateProfit();
    }catch (error) {
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
  const nameFilter = document.getElementById('filterSalesClientName')?.value?.trim().toLowerCase();

  tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading...</td></tr>';

  try {
    let query = db.collection('sales').orderBy('timestamp', 'desc'); // Changed from timestamp to date

    // Convert date strings to Date objects at midnight (00:00:00)
    if (fromDate) {
      const startDate = new Date(fromDate);
      startDate.setHours(0, 0, 0, 0);
      query = query.where('date', '>=', startDate);
    }
    
    if (toDate) {
      const endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999); // Include entire end day
      query = query.where('date', '<=', endDate);
    }

    const snapshot = await query.get();
    
    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center">No records found</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    
    // Filter by client name if provided
    snapshot.docs.forEach(doc => {
      const sale = doc.data();
      if (nameFilter && !sale.clientName?.toLowerCase().includes(nameFilter)) {
        return; // Skip if doesn't match name filter
      }
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(sale.date)}</td>
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
      tbody.appendChild(tr);
    });

    // Add the formatDate helper function
    function formatDate(date) {
      if (!date) return '';
      const d = date.toDate ? date.toDate() : new Date(date);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    }

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
