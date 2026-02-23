// Test Task 1 - Simple Node.js test script

function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

function runTests() {
  console.log('Running Test Task 1...\n');
  
  // Test 1: Addition
  const test1 = add(2, 3);
  console.log(`Test 1 - Addition: 2 + 3 = ${test1}`);
  console.log(`Expected: 5, Result: ${test1}, Status: ${test1 === 5 ? 'PASS' : 'FAIL'}\n`);
  
  // Test 2: Multiplication
  const test2 = multiply(4, 5);
  console.log(`Test 2 - Multiplication: 4 * 5 = ${test2}`);
  console.log(`Expected: 20, Result: ${test2}, Status: ${test2 === 20 ? 'PASS' : 'FAIL'}\n`);
  
  // Test 3: Combined operation
  const test3 = add(multiply(2, 3), 4);
  console.log(`Test 3 - Combined: (2 * 3) + 4 = ${test3}`);
  console.log(`Expected: 10, Result: ${test3}, Status: ${test3 === 10 ? 'PASS' : 'FAIL'}\n`);
  
  console.log('All tests completed!');
}

runTests();
