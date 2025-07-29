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
let barcodeTimeout;
const BARCODE_DELAY = 50;

auth.onAuthStateChanged(user => {
  if (!user) {
    window.location = 'index.html';
  } else {
    initializeApp();
  }
});

function initializeApp() {
  setupFilterButtons();
  setupClearFilterButtons();
  setupSaleTypeToggle();
  
  loadProducts();
  setupBarcodeScanner();
  setupSalesForm();
  loadSalesRecords();
  calculateProfit();
  
  document.getElementById('saleDate').valueAsDate = new Date();
  document.getElementById('saleBarcode').focus();
  
  document.getElementById('logoutBtn').addEventListener('click', () => auth.signOut());
}


// --- SALE TYPE TOGGLE WITH CREDIT FIELDS ---
function setupSaleTypeToggle() {
  const saleTypeSelect = document.getElementById('saleType');
  const creditFields = document.getElementById('creditFields');
  
  if (!saleTypeSelect || !creditFields) return;
  
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
    products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    alert('Error loading products');
  }
}

// --- BARCODE SCANNING ---
function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('saleBarcode');
  barcodeInput.addEventListener('keydown', e => {
    clearTimeout(barcodeTimeout);
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = barcodeInputBuffer.trim();
      barcodeInputBuffer = '';
      if (code.length > 0) {
        processScannedBarcode(code);
      }
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      barcodeInputBuffer += e.key;
      barcodeTimeout = setTimeout(() => barcodeInputBuffer = '', BARCODE_DELAY);
    }
  });
  
  barcodeInput.addEventListener('input', async e => {
    const val = e.target.value.trim();
    if (val.length >= 6) { // Changed from 5 to 6 digits
      const searchTerm = val.slice(-6); // Get last 6 digits
      
      // Find all products that have any barcode ending with these 6 digits
      const matches = [];
      for (const product of products) {
        if (product.barcodes) {
          const matchingBarcodes = product.barcodes.filter(bc => bc.endsWith(searchTerm));
          if (matchingBarcodes.length > 0) {
            // Include the full matching barcode in the result
            matches.push({
              product: product,
              matchingBarcode: matchingBarcodes[0] // Use the first matching barcode
            });
          }
        }
      }
      
      if (matches.length === 1) {
        // Use the full barcode from the match
        const fullBarcode = matches[0].matchingBarcode;
        addProductFromManualInput(matches[0].product, fullBarcode);
        barcodeInput.value = '';
        barcodeInputBuffer = '';
      } else if (matches.length > 1) {
        alert('More than one product matches; please provide more digits.');
      }
    }
  });
}
function addProductFromManualInput(product, inputBarcode) {
  if (currentSaleItems.some(item => item.scannedBarcodes.includes(inputBarcode))) {
    alert(`Product "${product.itemName}" with barcode ${inputBarcode} already scanned!`);
    playSound('error');
    return;
  }
  
  if ((product.stockQty || 0) <= 0) {
    alert(`Product "${product.itemName}" is out of stock!`);
    playSound('error');
    return;
  }

  // Check if we already have this product in sale
  const existingProductIndex = currentSaleItems.findIndex(item => item.id === product.id);

  if (existingProductIndex >= 0) {
    // Add barcode to existing product
    currentSaleItems[existingProductIndex].scannedBarcodes.push(inputBarcode);
    currentSaleItems[existingProductIndex].total += product.sellingPrice;
  } else {
    // Add new product
    currentSaleItems.push({
      id: product.id,
      itemName: product.itemName,
      sellingPrice: product.sellingPrice,
      costPrice: product.costPrice,
      category: product.category,
      scannedBarcodes: [inputBarcode],
      total: product.sellingPrice
    });
  }

  updateSaleSummary();
  playSound('success');
}

async function processScannedBarcode(barcode) {
  if (!barcode) return;
  
  // Check if this barcode exists in ANY scannedBarcodes array
  const alreadyScanned = currentSaleItems.some(item => 
    item.scannedBarcodes.includes(barcode)
  );
  
  if (alreadyScanned) {
    alert('This barcode has already been scanned in this sale!');
    playSound('error');
    document.getElementById('saleBarcode').value = '';
    return;
  }

  const barcodeInput = document.getElementById('saleBarcode');
  
  try {
    const snapshot = await db.collection('stockmgt')
      .where('barcodes', 'array-contains', barcode)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const product = { id: doc.id, ...doc.data() };
      
      if (product.stockQty <= 0) {
        alert(`Product "${product.itemName}" is out of stock!`);
        playSound('error');
        barcodeInput.value = '';
        return;
      }

      // Check if we already have this product in sale
      const existingProductIndex = currentSaleItems.findIndex(
        item => item.id === product.id
      );

      if (existingProductIndex >= 0) {
        // Add barcode to existing product
        currentSaleItems[existingProductIndex].scannedBarcodes.push(barcode);
        currentSaleItems[existingProductIndex].total += product.sellingPrice;
      } else {
        // Add new product
        currentSaleItems.push({
          id: product.id,
          itemName: product.itemName,
          sellingPrice: product.sellingPrice,
          costPrice: product.costPrice,
          category: product.category,
          scannedBarcodes: [barcode],
          total: product.sellingPrice
        });
      }

      updateSaleSummary();
      playSound('success');
      barcodeInput.value = '';
    } else {
      alert(`Product with barcode ${barcode} not found in stock!`);
      playSound('error');
      barcodeInput.value = '';
    }
  } catch (error) {
    console.error("Barcode processing error:", error);
    alert('Error fetching product. Check connectivity.');
    barcodeInput.value = '';
  }
}

// --- SALE SUMMARY ---
function updateSaleSummary() {
  const container = document.getElementById('saleItemsContainer');
  container.innerHTML = '';
  
  currentSaleItems.forEach((item, index) => {
    const quantity = item.scannedBarcodes.length;
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
      <span>Total: <input 
        type="number" 
        class="sale-item-total" 
        data-index="${index}" 
        value="${item.total.toFixed(2)}" 
        min="0" step="0.01" 
        style="width: 80px;"
      /></span>
      <button class="remove-item" data-index="${index}">×</button>
    `;
    container.appendChild(div);
  });

  // Attach event listeners for unit price inputs
  document.querySelectorAll('.sale-unit-price').forEach(input => {
    input.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      const newUnitPrice = parseFloat(e.target.value);
      if (!isNaN(newUnitPrice) && newUnitPrice >= 0) {
        currentSaleItems[index].sellingPrice = newUnitPrice;
        currentSaleItems[index].total = newUnitPrice * currentSaleItems[index].scannedBarcodes.length;
        updateSaleSummary(); // Refresh to update totals and inputs
      } else {
        e.target.value = currentSaleItems[index].sellingPrice.toFixed(2);
      }
    });
  });

  // Attach event listeners for total inputs
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

  // Remove item functionality
  document.querySelectorAll('.remove-item').forEach(button => {
    button.addEventListener('click', e => {
      const index = parseInt(e.target.dataset.index);
      currentSaleItems.splice(index, 1);
      updateSaleSummary();
    });
  });

  // Update grand total
  const subtotal = currentSaleItems.reduce((sum, item) => sum + item.total, 0);
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
    const date = document.getElementById('saleDate').value;
    const clientName = document.getElementById('clientName').value.trim();
    const clientPhone = document.getElementById('clientPhone').value.trim();
    const saleType = document.getElementById('saleType') ? document.getElementById('saleType').value : "cash";
    const dueDate = document.getElementById('dueDate') ? document.getElementById('dueDate').value : "";
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

      // First verify all items have sufficient stock and valid barcodes
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

      // Process all items
      for (const item of currentSaleItems) {
        const itemRef = stockRef.doc(item.id);
        
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
            quantity: 1,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            totalCost: item.costPrice,
            creditAmount: creditAmount,
            amountPaid: initialPayment,
            balance: balance,
            dueDate,
            status: balance <= 0 ? 'Paid' : (initialPayment > 0 ? 'Partial' : 'Pending'),
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
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
            quantity: 1,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            totalCost: item.costPrice,
            totalSale: item.sellingPrice,
            saleType: "cash",
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
        }

        // Update stock and barcodes
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
      if (typeof loadCreditSales === 'function') loadCreditSales();
      calculateProfit();
    } catch (error) {
      alert('Error processing sale: ' + error.message);
      console.error(error);
    }
  });
}

function playSound(type) {
  const audio = new Audio();
  audio.src = type === 'success'
    ? 'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3'
    : 'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
  audio.play();
}

// --- LOAD SALES RECORDS ---
async function loadSalesRecords() {
  const tbody = document.getElementById('salesRecordsTableBody');
  const fromDate = document.getElementById('filterSalesFromDate')?.value;
  const toDate = document.getElementById('filterSalesToDate')?.value;
  const nameFilter = document.getElementById('filterSalesClientName')?.value.trim().toLowerCase();

  tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading...</td></tr>';

  try {
    let query = db.collection('sales').orderBy('timestamp', 'desc');
    
    // Apply date filters
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
    tbody.innerHTML = '';

    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center">No records found</td></tr>';
      return;
    }

    snapshot.forEach(doc => {
      const sale = doc.data();
      // Apply client name filter if it exists
      const matchesClient = !nameFilter || 
                          (sale.clientName && sale.clientName.toLowerCase().includes(nameFilter));
      
      if ((!sale.saleType || sale.saleType === 'cash' || sale.saleType === 'credit-paid') && matchesClient) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${sale.date || ''}</td>
          <td>${sale.clientName || ''}</td>
          <td>${sale.clientPhone || ''}</td>
          <td>${sale.itemName || ''}</td>
          <td>${sale.scannedBarcode || 'N/A'}</td>
          <td>${sale.category || ''}</td>
          <td>${sale.quantity || ''}</td>
          <td>${sale.sellingPrice ? sale.sellingPrice.toFixed(2) : ''}</td>
          <td>${sale.totalSale ? sale.totalSale.toFixed(2) : ''}</td>
          <td>
            <div class="dropdown">
              <button class="btn btn-sm btn-secondary dropdown-toggle" type="button" 
                      onclick="toggleDropdown(this)">
                Actions
              </button>
              <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="#" onclick="printReceipt('${doc.id}')">
                  <i class="bi bi-receipt"></i> Receipt
                </a></li>
                <li><a class="dropdown-item" href="#" onclick="refundSale('${doc.id}')">
                  <i class="bi bi-arrow-counterclockwise"></i> Refund
                </a></li>
                <li><a class="dropdown-item" href="#" onclick="viewDetails('${doc.id}')">
                  <i class="bi bi-eye"></i> Details
                </a></li>
              </ul>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      }
    });

  } catch (error) {
    console.error("Error loading sales:", error);
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading records</td></tr>';
  }
}
// Dropdown toggle function
window.toggleDropdown = function(button) {
  const menu = button.nextElementSibling;
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
};

// Action functions for dropdown
window.printReceipt = function(saleId) {
  console.log("Print receipt for:", saleId);
  // Implement receipt printing
};

window.refundSale = function(saleId) {
  if (confirm("Are you sure you want to refund this sale?")) {
    console.log("Processing refund for:", saleId);
    // Implement refund logic
  }
};

window.viewDetails = function(saleId) {
  console.log("Viewing details for:", saleId);
  // Implement details view
};
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
    
    // Apply the same date filters as loadSalesRecords()
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

    salesSnap.forEach(doc => {
      const sale = doc.data();
      // Apply client name filter if it exists
      const matchesClient = !nameFilter || 
                          (sale.clientName && sale.clientName.toLowerCase().includes(nameFilter));
      
      if ((!sale.saleType || sale.saleType === "cash" || sale.saleType === "credit-paid") && matchesClient) {
        totalSales += sale.totalSale || 0;
        totalCost += sale.totalCost || 0;
      }
    });

    const totalProfit = totalSales - totalCost;
    document.getElementById('totalSales').textContent = totalSales.toFixed(2);
    document.getElementById('totalCost').textContent = totalCost.toFixed(2);
    document.getElementById('profit').textContent = totalProfit.toFixed(2);
    const profitElement = document.getElementById('profit');
    profitElement.style.color = totalProfit >= 0 ? 'green' : 'red';
  } catch (error) {
    console.error("Error calculating profit:", error);
    alert('Error calculating profit. Check console for details.');
  }
}
window.calculateProfit = calculateProfit;

// --- ON LOAD ---
window.onload = () => {
  document.getElementById('saleBarcode')?.focus();
  loadSalesRecords();
  calculateProfit();
};
