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

// Global variables
let products = [];
let currentSaleItems = [];
let barcodeInputBuffer = '';
let barcodeTimeout;
const BARCODE_DELAY = 50; // Time between barcode characters (ms)

// Initialize the sales system
auth.onAuthStateChanged(user => {
  if (!user) {
    window.location = 'index.html';
  } else {
    loadProducts();
    setupBarcodeScanner();
    setupSalesForm();
    loadSalesRecords();
    loadCreditSales();
    calculateProfit();
    document.getElementById('saleDate').valueAsDate = new Date();
    document.getElementById('saleBarcode').focus();

    // Show/hide due date and initial payment inputs based on sale type
    const saleTypeSelect = document.getElementById('saleType');
    const dueDateInput = document.getElementById('dueDate');
    const dueDateLabel = document.getElementById('dueDateLabel');
    const initialPaymentInput = document.getElementById('initialPayment');
    const initialPaymentLabel = document.getElementById('initialPaymentLabel');

    function toggleCreditFields() {
      if (saleTypeSelect.value === 'credit') {
        dueDateInput.style.display = 'inline-block';
        dueDateLabel.style.display = 'inline-block';
        initialPaymentInput.style.display = 'inline-block';
        initialPaymentLabel.style.display = 'inline-block';

        // Default due date 30 days from today
        const today = new Date();
        const due = new Date(today.setDate(today.getDate() + 30));
        dueDateInput.valueAsDate = due;

        initialPaymentInput.value = '';
      } else {
        dueDateInput.style.display = 'none';
        dueDateLabel.style.display = 'none';
        initialPaymentInput.style.display = 'none';
        initialPaymentLabel.style.display = 'none';

        dueDateInput.value = '';
        initialPaymentInput.value = '';
      }
    }

    saleTypeSelect.addEventListener('change', toggleCreditFields);
    toggleCreditFields(); // initialize on load

    // Setup grouped receipt print button handler if form exists
    const groupReceiptForm = document.getElementById('groupReceiptForm');
    if (groupReceiptForm) {
      groupReceiptForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const clientName = document.getElementById('receipt-client').value.trim();
        const date = document.getElementById('receipt-date').value;
        if (!clientName || !date) {
          alert("Please enter both client name and date.");
          return;
        }
        try {
          const salesSnapshot = await db.collection("sales")
            .where("clientName", "==", clientName)
            .where("date", "==", date)
            .get();
          if (salesSnapshot.empty) {
            alert("No sales found for this client on this date.");
            return;
          }
          const items = [];
          let clientPhone = '';
          salesSnapshot.forEach(doc => {
            const sale = doc.data();
            items.push({
              itemName: sale.itemName || '',
              category: sale.category || '',
              barcode: sale.barcode || '',
              quantity: sale.quantity || 0,
              price: sale.sellingPrice || (sale.amount / sale.quantity) || 0
            });
            if (!clientPhone && sale.clientPhone) clientPhone = sale.clientPhone;
          });
          let total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
          let cashInput = prompt("Enter cash received for this group sale:", total.toFixed(2));
          let cash = parseFloat(cashInput);
          if (isNaN(cash) || cash < total) {
            alert("Invalid cash amount entered. Using total sale amount as cash.");
            cash = total;
          }
          const saleForReceipt = {
            items: items,
            cash: cash,
            date: date,
            clientName: clientName,
            clientPhone: clientPhone
          };
          generateGroupReceipt(saleForReceipt);
        } catch (error) {
          console.error("Error generating group receipt:", error);
          alert("Failed to generate group receipt. Check console for details.");
        }
      });
    }

    // Add filter button listeners
    document.getElementById('filterSalesBtn').addEventListener('click', loadSalesRecords);
    document.getElementById('filterCreditsBtn').addEventListener('click', loadCreditSales);
  }
});

// Load all products from Firestore
async function loadProducts() {
  try {
    const snapshot = await db.collection('stockmgt').get();
    products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`${products.length} products loaded`);
  } catch (error) {
    console.error("Error loading products:", error);
    alert("Error loading products. Check console for details.");
  }
}

// Setup USB barcode scanner handler
function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('saleBarcode');
  barcodeInput.addEventListener('keydown', function(e) {
    clearTimeout(barcodeTimeout);
    if (e.key === 'Enter') {
      e.preventDefault();
      processScannedBarcode(barcodeInputBuffer.trim());
      barcodeInputBuffer = '';
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      barcodeInputBuffer += e.key;
      barcodeTimeout = setTimeout(() => barcodeInputBuffer = '', BARCODE_DELAY);
    }
  });
}

// Process scanned barcode
async function processScannedBarcode(barcode) {
  if (!barcode) return;
  const product = products.find(p => p.barcode === barcode);
  const barcodeInput = document.getElementById('saleBarcode');
  if (product) {
    const existingItemIndex = currentSaleItems.findIndex(item => item.barcode === barcode);
    if (existingItemIndex >= 0) {
      if (currentSaleItems[existingItemIndex].quantity < currentSaleItems[existingItemIndex].stockQty) {
        currentSaleItems[existingItemIndex].quantity++;
        currentSaleItems[existingItemIndex].total =
          currentSaleItems[existingItemIndex].quantity * currentSaleItems[existingItemIndex].sellingPrice;
      } else {
        alert(`Only ${currentSaleItems[existingItemIndex].stockQty} available in stock!`);
      }
    } else {
      currentSaleItems.push({
        ...product,
        quantity: 1,
        total: product.sellingPrice
      });
    }
    barcodeInput.value = '';
    updateSaleSummary();
    playSound('success');
    const quantityInputs = document.querySelectorAll('.sale-item-quantity');
    if (quantityInputs.length > 0) {
      quantityInputs[quantityInputs.length - 1].focus();
      quantityInputs[quantityInputs.length - 1].select();
    }
  } else {
    barcodeInput.value = '';
    playSound('error');
    alert(`Product with barcode ${barcode} not found!`);
  }
}

// Update sale summary display
function updateSaleSummary() {
  const summaryContainer = document.getElementById('saleItemsContainer');
  summaryContainer.innerHTML = '';
  currentSaleItems.forEach((item, index) => {
    const itemElement = document.createElement('div');
    itemElement.className = 'sale-item';
    itemElement.innerHTML = `
      <span>${item.itemName} (${item.barcode})</span>
      <input type="number" class="sale-item-quantity" value="${item.quantity}"
             min="1" max="${item.stockQty}" data-index="${index}">
      <input type="number" class="sale-item-price" value="${item.sellingPrice.toFixed(2)}"
             min="0" step="0.01" data-index="${index}" style="width:60px;" />
      <span>= <span class="sale-item-total">${item.total.toFixed(2)}</span></span>
      <button class="remove-item" data-index="${index}">×</button>
    `;
    summaryContainer.appendChild(itemElement);
  });

  // Quantity change
  document.querySelectorAll('.sale-item-quantity').forEach(input => {
    input.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const newQuantity = parseInt(e.target.value);
      if (newQuantity > currentSaleItems[index].stockQty) {
        alert(`Only ${currentSaleItems[index].stockQty} available in stock!`);
        e.target.value = currentSaleItems[index].stockQty;
        return;
      }
      if (newQuantity < 1) {
        e.target.value = 1;
        return;
      }
      currentSaleItems[index].quantity = newQuantity;
      currentSaleItems[index].total = newQuantity * currentSaleItems[index].sellingPrice;
      updateSaleSummary();
    });
  });

  // Price change
  document.querySelectorAll('.sale-item-price').forEach(input => {
    input.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const newPrice = parseFloat(e.target.value);
      if (isNaN(newPrice) || newPrice < 0) {
        e.target.value = currentSaleItems[index].sellingPrice.toFixed(2);
        return;
      }
      currentSaleItems[index].sellingPrice = newPrice;
      currentSaleItems[index].total = currentSaleItems[index].quantity * newPrice;
      updateSaleSummary();
    });
  });

  // Remove item
  document.querySelectorAll('.remove-item').forEach(button => {
    button.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      currentSaleItems.splice(index, 1);
      updateSaleSummary();
    });
  });

  const subtotal = currentSaleItems.reduce((sum, item) => sum + item.total, 0);
  document.getElementById('saleTotal').value = subtotal.toFixed(2);

  // Allow manual total edit (optional, but not recommended)
  document.getElementById('saleTotal').addEventListener('change', function(e) {
    const newTotal = parseFloat(e.target.value);
    if (!isNaN(newTotal) && currentSaleItems.length > 0) {
      const subtotal = currentSaleItems.reduce((sum, item) => sum + item.total, 0);
      const diff = newTotal - subtotal;
      let lastItem = currentSaleItems[currentSaleItems.length - 1];
      lastItem.sellingPrice += diff / lastItem.quantity;
      lastItem.total = lastItem.quantity * lastItem.sellingPrice;
      updateSaleSummary();
    }
  });
}

// Setup sales form submission
function setupSalesForm() {
  document.getElementById('salesForm').addEventListener('submit', async (e) => {
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
            date,
            clientName,
            clientPhone,
            barcode: item.barcode,
            itemName: item.itemName,
            quantity: item.quantity,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            totalCost: item.costPrice * item.quantity,
            creditAmount,
            amountPaid: initialPayment,
            balance,
            dueDate,
            status: balance <= 0 ? 'Paid' : 'Pending',
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });

          const itemRef = stockRef.doc(item.id);
          batch.update(itemRef, {
            stockQty: firebase.firestore.FieldValue.increment(-item.quantity)
          });
        }
      } else {
        const salesRef = db.collection('sales');

        currentSaleItems.forEach(item => {
          const newSaleRef = salesRef.doc();
          batch.set(newSaleRef, {
            date,
            clientName,
            clientPhone,
            barcode: item.barcode,
            itemName: item.itemName,
            quantity: item.quantity,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            totalCost: item.costPrice * item.quantity,
            totalSale: item.total,
            saleType,
            category: item.category || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });

          const itemRef = stockRef.doc(item.id);
          batch.update(itemRef, {
            stockQty: firebase.firestore.FieldValue.increment(-item.quantity)
          });
        });
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
  audio.src = type === 'success' ?
    'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3' :
    'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
  audio.play();
}

// Load sales records
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
      <td>${sale.barcode}</td>
      <td>${sale.category || ''}</td>
      <td>${sale.quantity}</td>
      <td>${sale.sellingPrice.toFixed(2)}</td>
      <td>${sale.totalSale.toFixed(2)}</td>
      <td>${sale.saleType}</td>
    `;
    tbody.appendChild(tr);
  });
}
window.loadSalesRecords = loadSalesRecords;

// Load credit sales
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
