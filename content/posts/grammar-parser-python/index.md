+++
date = '2026-03-22T00:17:30+01:00'
draft = true
title = 'Building a Parser for user-defined Grammars in Python'
math = true
+++


Hi, in this post I will talk about parsing code using grammars given by the user. This is as preparation for my next project which is to write a parser library in rust.
## Goals for this project
In this project I want to develop a library that allows the user to:

1. Define a grammar as code
2. Include construction rules inside that grammar that define the structure of the output AST
3. Parse code that follows the grammar defined by the user into the AST format defined by the user
<!--more-->
But first let's cover some basics.
## What is parsing?
According to the oxford dictionary, this is the definition of parsing:
> analyse (a string or text) into logical syntactic components.

To me it means taking a string and turning it into a data structure that is easier to work with. In this context we will be parsing code into a data structure called an Abstract Syntax Tree or AST. 
### AST
AST's represent code as the nesting of different "constructs" in the code. For example take the code $2 + 3 \cdot 4$. 

We could represent this as the following tree:

{{< mermaid >}}
graph TD
  Add(["Add"])
  Add -- left --> n1["2"]
  Add -- right --> Mul(["Mul"])
  Mul -- left --> n2["3"]
  Mul -- right --> n3["4"]

{{< /mermaid >}}

We can then perform various operations on this ast, for example we could evaluate it. We would first evaluate the multiplication node, which would give us $12$, and then we would evaluate the addition node, which would give us $14$.

{{< mermaid >}}
graph LR

subgraph G1["Original AST"]
Add(["Add"])
Add -- left --> n1["2"]
Add -- right --> Mul(["Mul"])
Mul -- left --> n2["3"]
Mul -- right --> n3["4"]
end

subgraph G2["After evaluating multiplication"]
Add2(["Add"])
Add2 -- left --> n4["2"]
Add2 -- right --> n5["12"]
end

subgraph G3["Final result"]
n6["14"]
end

G1 --> G2
G2 --> G3
{{< /mermaid >}}


We can also represent more complex code, for example the following code:

```python
while x < 10:
  x = x + 1
```

Could for example be represented as the following AST:
{{< mermaid >}}
graph TD
  While(["While"])
  While -- condition --> LT(["LessThan"])
  LT -- left --> Var(["x"])
  LT -- right --> n1["10"]
  While -- body --> Assign(["Assign"])
  Assign -- left --> Var2(["x"])
  Assign -- right --> Add(["Add"])
  Add -- left --> Var3(["x"])
  Add -- right --> n2["1"]
{{< /mermaid >}}

So the aim for this project is to be able to take code and turn it into an AST like this. The user can then later use this AST to do whatever they want, for example they could evaluate it, or they could compile it to some bytecode.

But for that there needs to be a way for the user to define how the code should be parsed. This is where grammars come in.
### Grammars

A grammar is a set of rules that define how to parse a given string into the ast.
It defines how the different constructs in the code can be combined into other constructs.

A rule in the Grammar looks like this: 
```BNF
<symbol> --> <expression>
```

> [!NOTE]-
> Formally, a grammar is defined as a tuple $(N, \Sigma, P, S)$ where:
> - $N$ is a finite set of non-terminal symbols, which are the "constructs" in the code. For example in the code above we have constructs like "While", "LessThan", "Assign", etc.
> - $\Sigma$ is a finite set of terminal symbols, which are the "tokens" in the code. For example in the code above we have tokens like "x", "10", "1", etc.
> - $P$ is a finite set of production rules of the form $\alpha \mapsto \beta$, where $\alpha$ is a sequence of at least one non-terminal symbol and any number of terminal symbols and $\beta$ is a sequence of any number of terminals and non-terminals. 
> - $S$ is the start symbol, which is the symbol that we want to parse. For example in the code above we want to parse a "While" statement, so "While" would be our start symbol.
> 
> The parser we will be writing in this post can only parse a subset of all grammars called LL(1). This allows us to use an algorithm called "Recursive Descent Parsing". In the next post I will try to implement a parser which can parse a larger subset called PEG (Parsing expression grammar). One of the properties of the LL(1) grammars is the in a production rule the left side always consists only of a single non-terminal symbol.

A **terminal** symbol is one that appears literally in the input string — it cannot be expanded further. Examples are keywords like `while`, operators like `+`, or raw values like numbers and identifiers. A **non-terminal** symbol on the other hand represents a construct that still needs to be expanded using a production rule. For example ``<expr> or <statement>`` are non-terminals — they describe a *category* of things, not a concrete token.

Let's make this concrete with a grammar for simple arithmetic expressions like $2 + 3 \cdot 4$:
```BNF
<expr>   --> <term> "+" <expr>
           | <term>

<term>   --> <factor> "*" <term>
           | <factor>

<factor> --> "(" <expr> ")"
           | NUMBER
```

Here `NUMBER`, `"+"`, `"*"`, `"("` and `")"` are terminals, while `<expr>`, `<term>` and `<factor>` are non-terminals. The `|` character means "or" — it separates multiple alternative rules for the same non-terminal. The start symbol is `<expr>`.

Notice that the grammar naturally encodes operator precedence: `<term>` is nested *inside* `<expr>`, which means multiplication binds tighter than addition. When we parse $2 + 3 \cdot 4$, the `<expr>` rule will group it as $2 + (3 \cdot 4)$, producing exactly the AST we saw earlier.

We can also encode more complex structures like a while loop, for example:
```BNF
<stmt>       --> <while_stmt>
              | <assignment>
              | <expr>

<while_stmt> --> "while" "(" <expr> ")" <block>

<block>      --> "{" <stmts> "}"
              | <stmt>

<stmts>      --> <stmt> <stmts>
              | <stmt>

<assignment> --> IDENTIFIER "=" <expr>
```

this grammar will be able to parse code like:
```c
while (x + 1) {
  y = 2 * 3
  while (z) {
    x = 4
  }
}
```

## Lexing

Before we can parse anything, we need to turn the raw input string into a list of **tokens**. This step is called **lexical analysis** (or just *lexing*), and the component that does it is called a **lexer** (or *tokenizer*).

### What is a Token?

A token is the smallest meaningful unit in the input. For example, given the string:
```
while (x + 10) { y = 2 * 3 }
```

A lexer would produce something like:

| Value   | Type   |
| ------- | ------ |
| `while` | WORD   |
| `(`     | SYMBOL |
| `x`     | WORD   |
| `+`     | SYMBOL |
| `10`    | NUMBER |
| `)`     | SYMBOL |
| ...     | ...    |

Rather than having the parser deal with individual characters, it can now work with these higher-level units. This makes the parsing logic significantly cleaner.

### Our Lexer

Our lexer recognises four kinds of tokens:

- **WORD** — sequences of alphabetic characters and underscores (e.g. `while`, `x`, `my_var`)
- **NUMBER** — sequences of digits, optionally containing a separator like `.` for decimals
- **SYMBOL** — operator and punctuation characters like `+`, `*`, `<=` (multi-character symbols are supported)
- **STRING** — quoted literals like `"hello"` or `'world'`, with escape sequences

The lexer is configured by the user rather than hardcoded, which fits our goal of a general-purpose library. You call it like this:
```python
tokens = lex("x + 10 * y", symbol_chars="+-*/")
```

And you can pass in additional options like `multi_symbols` for things like `<=` or `!=`:
```python
tokens = lex("x <= 10", symbol_chars="<=", multi_symbols=["<="])
```

### How it Works

The lexer wraps the input in a `CharStream`, which tracks the current line and column as it advances through the string character by character. At each step it peeks at the next character and decides which rule to apply:
```python
if char in self.alphabet:
    self.lex_word()
elif char.isdigit():
    self.lex_number()
elif char in self.symbol_chars:
    self.lex_symbol()
elif is_whitespace(char):
    self.lex_whitespace()  # simply skipped
elif char in self.str_chars:
    self.lex_string()
else:
    raise LexerError(f"Unknown character '{char}'", ...)
```

Each `lex_*` method consumes characters from the stream until it hits something that no longer belongs to that token type, then appends the completed token to the output list.

One nice detail is that every token stores not just its value and type, but also a `CodeSlice` — the exact start and end position in the source. This makes it possible to produce helpful error messages later that highlight exactly where in the code something went wrong.

### From Tokens to a Token Stream

After lexing, the flat list of tokens is wrapped in a `TokenStream`, which provides `peek()` and `next()` methods. This is the interface the parser will use — it can look ahead one token to decide which grammar rule to apply, then consume it when it's ready to move on.

With the lexer in place, the parser never has to think about whitespace, character boundaries, or source positions — all of that complexity has already been handled.

## Our Parser

Now, how will we go about parsing code using grammars defined by the user? We will use an algorithm called **Recursive Descent Parsing**.

### Recursive Descent Parsing

Normally, in Recursive Descent Parsing each production rule is implemented as a function in the code. For example the `<expr>` rule from above could be implemented something like this:
```python
def parse_expr(tokens: TokenStream):
    left = parse_term(tokens)
    if tokens.peek() is not None and tokens.peek().value == "+":
        tokens.next()  # consume the "+"
        right = parse_expr(tokens)
        return AddNode(left, right)
    return left
```

But we don't want to hardcode the grammars in code, we want the user to define the grammars and 

change!