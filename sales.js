// Initialize Firebase
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

let products = [];
let currentSaleItems = [];
let barcodeInputBuffer = '';
let barcodeTimeout;
const BARCODE_DELAY = 50;

// Auth state listener
auth.onAuthStateChanged(user => {
  if (!user) {
    window.location = 'index.html';
    return;
  }
  initializeApp();
});

function initializeApp() {
  loadProducts();
  setupBarcodeScanner();
  setupSalesForm();
  loadSalesRecords();
  loadCreditSales();
  calculateProfit();

  document.getElementById('saleDate').valueAsDate = new Date();
  document.getElementById('saleBarcode').focus();

  setupSaleTypeToggle();
  setupGroupReceiptForm();
  setupFilterButtons();
}

// Load products from Firestore
async function loadProducts() {
  try {
    const snapshot = await db.collection('stockmgt').get();
    products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error loading products:", error);
    alert("Error loading products. Check console for details.");
  }
}

// Setup barcode scanner input with buffer and manual input support
function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('saleBarcode');

  // Keyboard buffer for scanner input
  barcodeInput.addEventListener('keydown', e => {
    clearTimeout(barcodeTimeout);
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = barcodeInputBuffer.trim();
      barcodeInputBuffer = '';
      if (code.length > 0) {
        processScannedBarcode(code);
      }
      barcodeInput.value = ''; // Clear input field after processing
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      barcodeInputBuffer += e.key;
      barcodeTimeout = setTimeout(() => barcodeInputBuffer = '', BARCODE_DELAY);
    }
  });

  // Manual input detection for partial barcode matching (last 5 digits)
  barcodeInput.addEventListener('input', e => {
    const val = e.target.value.trim();

    if (val.length >= 5) {
      const searchTerm = val.slice(-5);

      const matches = products.filter(product =>
        product.barcodes?.some(bc => bc.endsWith(searchTerm))
      );

      if (matches.length === 1) {
        addProductFromManualInput(matches[0], val);
        barcodeInput.value = '';
        barcodeInputBuffer = '';
      } else if (matches.length > 1) {
        console.log(`Multiple products match barcode ending with "${searchTerm}". Please enter more digits.`);
      } else {
        console.log(`No product found with barcode ending "${searchTerm}".`);
      }
    }
  });
}

// Add product from manual input or partial barcode match
function addProductFromManualInput(product, inputBarcode) {
  if ((product.stockQty || 0) <= 0) {
    alert(`Product "${product.itemName}" is out of stock!`);
    playSound('error');
    return;
  }

  // Each scanned barcode is a separate unit, so add a new item for each barcode
  currentSaleItems.push({
    id: product.id,
    itemName: product.itemName,
    sellingPrice: product.sellingPrice,
    costPrice: product.costPrice,
    category: product.category,
    scannedBarcodes: [inputBarcode], // single barcode per sale item
    total: product.sellingPrice
  });

  updateSaleSummary();
  playSound('success');

  const quantityInputs = document.querySelectorAll('.sale-item-quantity');
  if (quantityInputs.length > 0) {
    quantityInputs[quantityInputs.length - 1].focus();
    quantityInputs[quantityInputs.length - 1].select();
  }
}

// Process scanned barcode and add as individual sale item
async function processScannedBarcode(barcode) {
  if (!barcode) return;
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

      // Add a new sale item for this scanned barcode
      currentSaleItems.push({
        id: product.id,
        itemName: product.itemName,
        sellingPrice: product.sellingPrice,
        costPrice: product.costPrice,
        category: product.category,
        scannedBarcodes: [barcode], // single barcode per sale item
        total: product.sellingPrice
      });

      barcodeInput.value = '';
      updateSaleSummary();
      playSound('success');

      const quantityInputs = document.querySelectorAll('.sale-item-quantity');
      if (quantityInputs.length > 0) {
        quantityInputs[quantityInputs.length - 1].focus();
        quantityInputs[quantityInputs.length - 1].select();
      }
    } else {
      alert(`Product with barcode ${barcode} not found in stock!`);
      playSound('error');
      barcodeInput.value = '';
    }
  } catch (error) {
    console.error("Barcode fetch error:", error);
    alert("Error fetching product. Please try again.");
    playSound('error');
    barcodeInput.value = '';
  }
}

// Update sale items UI and totals
function updateSaleSummary() {
  const container = document.getElementById('saleItemsContainer');
  container.innerHTML = '';
  currentSaleItems.forEach((item, index) => {
    const quantity = item.scannedBarcodes.length; // always 1 here
    const div = document.createElement('div');
    div.className = 'sale-item';
    div.innerHTML = `
      <span>${item.itemName} (Barcode: ${item.scannedBarcodes[0]})</span>
      <input type="number" class="sale-item-quantity" value="${quantity}" min="1" max="${quantity}" data-index="${index}" disabled />
      <input type="number" class="sale-item-price" value="${item.sellingPrice.toFixed(2)}" min="0" step="0.01" data-index="${index}" style="width:60px;" />
      <span>= <span class="sale-item-total">${item.total.toFixed(2)}</span></span>
      <button class="remove-item" data-index="${index}">×</button>
    `;
    container.appendChild(div);
  });

  document.querySelectorAll('.sale-item-price').forEach(input => {
    input.addEventListener('change', e => {
      const i = parseInt(e.target.dataset.index);
      const p = parseFloat(e.target.value);
      if (isNaN(p) || p < 0) {
        e.target.value = currentSaleItems[i].sellingPrice.toFixed(2);
        return;
      }
      currentSaleItems[i].sellingPrice = p;
      currentSaleItems[i].total = p * currentSaleItems[i].scannedBarcodes.length;
      updateSaleSummary();
    });
  });

  document.querySelectorAll('.remove-item').forEach(button => {
    button.addEventListener('click', e => {
      const i = parseInt(e.target.dataset.index);
      currentSaleItems.splice(i, 1);
      updateSaleSummary();
    });
  });

  const subtotal = currentSaleItems.reduce((sum, item) => sum + item.total, 0);
  document.getElementById('saleTotal').value = subtotal.toFixed(2);
}

// Setup sales form submission
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
    const saleType = document.getElementById('saleType').value;
    const dueDate = document.getElementById('dueDate').value;
    let initialPayment = parseFloat(document.getElementById('initialPayment').value);
    if (isNaN(initialPayment) || initialPayment < 0) initialPayment = 0;

    if (!date || !clientName) {
      alert('Please fill all required fields!');
      return;
    }
    if (saleType === 'credit' && !dueDate) {
      alert('Please select a due date for the credit sale.');
      return;
    }

    try {
      const batch = db.batch();
      const stockRef = db.collection('stockmgt');
      const transactionId = db.collection('sales').doc().id;

      if (saleType === 'credit') {
        const creditSalesRef = db.collection('creditSales');
        for (const item of currentSaleItems) {
          const creditAmount = item.total;
          if (initialPayment > creditAmount) {
            alert('Initial payment cannot exceed total credit amount.');
            return;
          }
          const balance = creditAmount - initialPayment;
          const newCreditSaleRef = creditSalesRef.doc();

          batch.set(newCreditSaleRef, {
            transactionId,
            date,
            clientName,
            clientPhone,
            scannedBarcode: item.scannedBarcodes[0], // single barcode per document
            itemName: item.itemName,
            quantity: 1,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            totalCost: item.costPrice,
            creditAmount: item.sellingPrice,
            amountPaid: initialPayment / currentSaleItems.length,
            balance: balance / currentSaleItems.length,
            dueDate,
            status: balance <= 0 ? 'Paid' : 'Pending',
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });

          const itemRef = stockRef.doc(item.id);
          batch.update(itemRef, {
            stockQty: firebase.firestore.FieldValue.increment(-1)
          });
        }
      } else {
        const salesRef = db.collection('sales');
        for (const item of currentSaleItems) {
          const newSaleRef = salesRef.doc();

          batch.set(newSaleRef, {
            transactionId,
            date,
            clientName,
            clientPhone,
            scannedBarcode: item.scannedBarcodes[0], // single barcode per document
            itemName: item.itemName,
            quantity: 1,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            totalCost: item.costPrice,
            totalSale: item.sellingPrice,
            saleType,
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });

          const itemRef = stockRef.doc(item.id);
          batch.update(itemRef, {
            stockQty: firebase.firestore.FieldValue.increment(-1)
          });
        }
      }

      await batch.commit();

      alert(`${saleType === 'credit' ? 'Credit sale' : 'Sale'} completed successfully!`);
      playSound('success');

      currentSaleItems = [];
      updateSaleSummary();
      document.getElementById('salesForm').reset();
      document.getElementById('saleDate').valueAsDate = new Date();
      document.getElementById('saleBarcode').focus();

      loadProducts();
      loadSalesRecords();
      loadCreditSales();
      calculateProfit();

    } catch (error) {
      console.error('Error processing sale:', error);
      alert('Error processing sale. Check console for details.');
      playSound('error');
    }
  });
}

// Play sound feedback
function playSound(type) {
  const audio = new Audio();
  audio.src = type === 'success'
    ? 'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3'
    : 'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
  audio.play();
}


// Load sales records with date filter
async function loadSalesRecords() {
  const tbody = document.getElementById('salesRecordsTableBody');
  const fromDate = document.getElementById('filterSalesFromDate')?.value;
  const toDate = document.getElementById('filterSalesToDate')?.value;
  let query = db.collection('sales').orderBy('timestamp', 'desc');
  if (fromDate && toDate) {
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    query = query.where('timestamp', '>=', startDate).where('timestamp', '<=', endDate);
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
  snapshot.forEach(doc => {
    const sale = doc.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sale.date}</td>
      <td>${sale.clientName}</td>
      <td>${sale.clientPhone}</td>
      <td>${sale.itemName}</td>
      <td>${sale.scannedBarcode || 'N/A'}</td> <!-- Fixed here -->
      <td>${sale.category || ''}</td>
      <td>${sale.quantity}</td>
      <td>${sale.sellingPrice.toFixed(2)}</td>
      <td>${sale.totalSale ? sale.totalSale.toFixed(2) : ''}</td>
      <td>${sale.saleType}</td>
    `;
    tbody.appendChild(tr);
  });
}
window.loadSalesRecords = loadSalesRecords;

// Load credit sales with date filter
async function loadCreditSales() {
  const fromDate = document.getElementById('filterCreditsFromDate')?.value;
  const toDate = document.getElementById('filterCreditsToDate')?.value;
  let query = db.collection('creditSales').orderBy('timestamp', 'desc');
  if (fromDate && toDate) {
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    query = query.where('timestamp', '>=', startDate).where('timestamp', '<=', endDate);
  } else if (fromDate) {
    const startDate = new Date(fromDate);
    query = query.where('timestamp', '>=', startDate);
  } else if (toDate) {
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    query = query.where('timestamp', '<=', endDate);
  }
  const snapshot = await query.get();
  const tbody = document.getElementById('creditSalesTableBody');
  tbody.innerHTML = '';
  snapshot.forEach(doc => {
    const sale = doc.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sale.date || ''}</td>
      <td>${sale.clientName || ''}</td>
      <td>${sale.clientPhone || ''}</td>
      <td>${sale.category || ''}</td>
      <td>${sale.itemName || ''}</td>
      <td>${sale.quantity || ''}</td>
      <td>${sale.creditAmount ? sale.creditAmount.toFixed(2) : ''}</td>
      <td>${sale.amountPaid ? sale.amountPaid.toFixed(2) : ''}</td>
      <td>${sale.balance ? sale.balance.toFixed(2) : ''}</td>
      <td>${sale.dueDate || 'N/A'}</td>
      <td>${sale.status || ''}</td>
      <td>
        <button onclick="payCredit('${doc.id}')">Pay</button>
        <button onclick="deleteCredit('${doc.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.loadCreditSales = loadCreditSales;

// Pay credit
async function payCredit(id) {
  const paymentStr = prompt('Enter payment amount:');
  const payment = parseFloat(paymentStr);
  if (isNaN(payment)) {
    alert('Please enter a valid number');
    return;
  }
  if (payment <= 0) {
    alert('Payment amount must be positive');
    return;
  }
  const docRef = db.collection('creditSales').doc(id);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    alert('Credit sale not found');
    return;
  }
  const data = docSnap.data();
  const newAmountPaid = (data.amountPaid || 0) + payment;
  const newBalance = (data.balance || 0) - payment;
  if (newBalance < 0) {
    alert('Payment exceeds balance');
    return;
  }
  const newStatus = newBalance <= 0 ? 'Paid' : 'Partial';
  await docRef.update({
    amountPaid: newAmountPaid,
    balance: newBalance,
    status: newStatus,
    lastPaymentDate: new Date().toISOString().split('T')[0]
  });
  alert('Payment recorded');
  loadCreditSales();
  calculateProfit();
}
window.payCredit = payCredit;

// Delete credit sale
async function deleteCredit(id) {
  if (confirm('Are you sure you want to delete this credit sale?')) {
    await db.collection('creditSales').doc(id).delete();
    alert('Credit sale deleted');
    loadCreditSales();
  }
}
window.deleteCredit = deleteCredit;

// Calculate profit & loss
async function calculateProfit() {
  const salesSnap = await db.collection('sales').get();
  const creditSnap = await db.collection('creditSales').get();
  let totalSales = 0;
  let totalCost = 0;
  let totalProfit = 0;
  salesSnap.forEach(doc => {
    const sale = doc.data();
    totalSales += sale.totalSale || 0;
    totalCost += sale.totalCost || 0;
  });
  creditSnap.forEach(doc => {
    const credit = doc.data();
    totalSales += credit.amountPaid || 0;
    totalCost += (credit.costPrice * credit.quantity) || 0;
  });
  totalProfit = totalSales - totalCost;
  document.getElementById('totalSales').textContent = totalSales.toFixed(2);
  document.getElementById('totalCost').textContent = totalCost.toFixed(2);
  document.getElementById('profit').textContent = totalProfit.toFixed(2);
  const profitElement = document.getElementById('profit');
  profitElement.style.color = totalProfit >= 0 ? 'green' : 'red';
}
window.calculateProfit = calculateProfit;

// Group Receipt Generation using Gadendigitech format (no logo)
function generateGroupReceipt(sale) {
  console.log('Generating receipt for sale:', sale);
  if (!sale) {
    alert('No sale data provided for receipt.');
    return;
  }
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };
  const formatCurrency = (amount) => parseFloat(amount).toFixed(2);
  let subtotal = 0;
  const itemsBody = [
    ['Item','Category', 'Barcode', 'Qty', 'Price']
  ];
  sale.items.forEach(item => {
    subtotal += item.price * item.quantity;
    itemsBody.push([
      { text: item.itemName || '', fontSize: 5, margin: [0, 0, 0, 0] },
      { text: item.category || '', fontSize: 5, margin: [0, 0, 0, 0] },
      { text: item.barcode || '', fontSize: 5, margin: [0, 0, 0, 0] },
      { text: item.quantity.toString(), fontSize: 5, alignment: 'center', margin: [0, 0, 0, 0] },
      { text: formatCurrency(item.price), fontSize: 5, alignment: 'right', margin: [0, 0, 0, 0] }
    ]);
  });
  const vat = subtotal * 0.16;
  const total = subtotal + vat;
  const cash = sale.cash !== undefined ? sale.cash : total;
  const change = (cash - total) > 0 ? (cash - total) : 0;
  const docDefinition = {
    pageSize: { width: 227, height: 'auto' },
    pageMargins: [10, 10, 10, 10],
    content: [
      { text: 'Gaden Digitech Ltd', style: 'header' },
      { text: 'Paybill:  | Acc: ', style: 'subheader' },
      { text: 'gadendigitech@gmail.com', style: 'subheader' },
      { text: `Receipt #: ${sale.id || ''}`, style: 'small' },
      { text: `Date: ${formatDate(sale.date)}`, style: 'small' },
      { text: `Client: ${sale.clientName}`, style: 'small' },
      { text: '\n' },
      {
        table: {
          widths: [60, 40, '*', 50, 30],
          body: itemsBody
        },
        layout: 'noBorders'
      },
      { text: '\n' },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            ['Subtotal', formatCurrency(subtotal)],
            ['VAT (16%)', formatCurrency(vat)],
            [{ text: 'TOTAL', bold: true }, { text: formatCurrency(total), bold: true }]
          ]
        },
        layout: 'noBorders'
      },
      { text: '\n' },
      { text: 'Goods sold are not returnable.', style: 'note' },
      { text: 'Served by: ' + (sale.servedBy || 'System'), style: 'note' }
    ],
    styles: {
      header: { fontSize: 10, bold: true, alignment: 'center', margin: [0, 0, 0, 2] },
      subheader: { fontSize: 8, alignment: 'center' },
      small: { fontSize: 8, alignment: 'center' },
      note: { fontSize: 7, italics: true, alignment: 'center' }
    },
    defaultStyle: {
      fontSize: 8
    },
    images: {}
  };
  pdfMake.createPdf(docDefinition).print();
}

// Auto-focus barcode input on page load
window.onload = () => {
  document.getElementById('saleBarcode')?.focus();
  loadCreditSales();
  loadSalesRecords();
  calculateProfit();
};
