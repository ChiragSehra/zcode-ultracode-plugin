// Toy calculator — CommonJS module. divide throws on a zero divisor
// (the `b === 0` check also catches -0, since -0 === 0 is true).

function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  if (b === 0) throw new Error('Cannot divide by zero');
  return a / b;
}

module.exports = { add, subtract, multiply, divide };
