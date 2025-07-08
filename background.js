// Array of background images for each page
// Background image animation with fade transition and loading effect
const pageBackgrounds = {
    'index': ['bg-login1.jpg', 'bg-login2.jpg', 'bg-login3.jpg'],
    'home': ['bg-home1.jpg', 'bg-home2.jpg'],
    'stock': ['bg-stock1.jpg', 'bg-stock2.jpg'],
    'sales': ['bg-sales1.jpg', 'bg-sales2.jpg', 'bg-sales3.jpg'],
    'signup': ['bg-signup1.jpg', 'bg-signup2.jpg']
  };
  
  const currentPage = document.body.className;
  
  function preloadImages(urls, callback) {
    let loaded = 0;
    const total = urls.length;
    urls.forEach(src => {
      const img = new Image();
      img.onload = () => {
        loaded++;
        if (loaded === total) callback();
      };
      img.onerror = () => {
        loaded++;
        if (loaded === total) callback();
      };
      img.src = src;
    });
  }
  
  if (pageBackgrounds[currentPage] && pageBackgrounds[currentPage].length > 1) {
    const urls = pageBackgrounds[currentPage].map(file => file);
    
    // Create loading overlay
    const loader = document.createElement('div');
    loader.id = 'bg-loader';
    loader.style.position = 'fixed';
    loader.style.top = 0;
    loader.style.left = 0;
    loader.style.width = '100%';
    loader.style.height = '100%';
    loader.style.backgroundColor = '#fff';
    loader.style.zIndex = 9999;
    loader.style.display = 'flex';
    loader.style.alignItems = 'center';
    loader.style.justifyContent = 'center';
    loader.style.fontSize = '2em';
    loader.style.fontFamily = 'Arial, sans-serif';
    loader.textContent = 'Preparing your dashboard...';
    document.body.appendChild(loader);
  
    // Preload then start animation
    preloadImages(urls, () => {
      document.body.removeChild(loader);
  
      let currentBg = 0;
      document.body.style.transition = 'background-image 1s ease-in-out, opacity 0.5s';
      document.body.style.backgroundImage = `url('${pageBackgrounds[currentPage][currentBg]}')`;
  
      setInterval(() => {
        currentBg = (currentBg + 1) % pageBackgrounds[currentPage].length;
        document.body.style.opacity = '0.10';
        setTimeout(() => {
          document.body.style.backgroundImage = `url('${pageBackgrounds[currentPage][currentBg]}')`;
          document.body.style.opacity = '1';
        }, 500);
      }, 1030000);
    });
  }
  
