import { Sandbox } from '../sdk/src/index.js';

async function main() {
  const sandbox = new Sandbox({
    apiKey: process.env.INSIEN_API_KEY || "your-api-key-here"
  });

  console.log('🚀 LeetCode-Style Code Execution Demo\n');
  console.log('Supported languages:', Sandbox.getSupportedLanguages().join(', '));
  console.log('');

  const examples = [
    {
      name: 'JavaScript - Hello World',
      language: 'javascript',
      code: `console.log('Hello, World!');
console.log('2 + 2 =', 2 + 2);`
    },
    {
      name: 'Python - Fibonacci',
      language: 'python',
      code: `def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

for i in range(10):
    print(f"fib({i}) = {fibonacci(i)}")`
    },
    {
      name: 'Java - Hello World',
      language: 'java',
      code: `public class main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
        System.out.println("Sum: " + (10 + 20));
    }
}`
    },
    {
      name: 'C++ - Hello World',
      language: 'cpp',
      code: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, World!" << endl;
    cout << "5 * 7 = " << 5 * 7 << endl;
    return 0;
}`
    },
    {
      name: 'Go - Hello World',
      language: 'go',
      code: `package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
    fmt.Println("10 + 20 =", 10 + 20)
}`
    }
  ];

  for (const example of examples) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 ${example.name}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Language: ${example.language}`);
    console.log(`\nCode:\n${example.code}\n`);
    console.log('Executing...\n');

    try {
      const result = await sandbox.runCode(example.code, example.language, {
        autoDestroy: true,
        timeout: 10000
      });

      if (result.success) {
        console.log('✅ Execution successful!');
        console.log('\nOutput:');
        console.log(result.stdout);
        if (result.stderr) {
          console.log('\nWarnings/Errors:');
          console.log(result.stderr);
        }
      } else {
        console.log('❌ Execution failed!');
        console.log('\nError:', result.error || 'Unknown error');
        if (result.stderr) {
          console.log('\nError output:');
          console.log(result.stderr);
        }
        if (result.compileResult) {
          console.log('\nCompilation output:');
          console.log(result.compileResult.stderr);
        }
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
    }

    console.log('\n' + '-'.repeat(60));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n✨ Demo completed!');
}

main().catch(console.error);

