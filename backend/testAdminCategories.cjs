const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

async function testAdminCategories() {
  const backendUrl = 'http://localhost:5000/api/v1';

  // 1. Login as admin
  console.log('Logging in as admin...');
  const loginRes = await fetch(`${backendUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@meryadz.com',
      password: 'MeryaAdmin2026!'
    })
  });

  const cookies = loginRes.headers.get('set-cookie');
  console.log('Login status:', loginRes.status, 'Cookie set:', Boolean(cookies));
  const loginData = await loginRes.json();
  console.log('Login response:', loginData.success);

  // 2. Fetch admin categories
  console.log('Calling /categories/admin/all...');
  const catRes = await fetch(`${backendUrl}/categories/admin/all`, {
    headers: {
      'Cookie': cookies || ''
    }
  });

  console.log('Categories admin response status:', catRes.status);
  const catText = await catRes.text();
  console.log('Categories admin response body:', catText);
}

testAdminCategories().catch(console.error);
