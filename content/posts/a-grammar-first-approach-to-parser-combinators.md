+++
date = '2026-05-26T13:05:21+02:00'
draft = false
title = 'A Grammar-First Approach to Parser Combinators in Rust'
+++

Rust already has well-established parser combinator libraries like nom and chumsky, so why build another one? 

In my experience, using parser combinator libraries often involves handling of intermediate values, ignoring certain results but keeping others and unwrapping tuples.

This is why I have been experimenting with a new approach in a library called [marser](https://github.com/ArneCode/marser). It allows users to define parsers using code with a structure resembling EBNF Grammars, seperating grammar shape from AST construction.

I will compare the syntax of marser with nom and chumsky using two examples, a simple ["dice notation"](#parsing-dice-notation) as an introduction and an example of parsing a [function signature](#parsing-function-signatures) using these libraries.
Afterwards I will look at how we can include [diagnostics and error recovery](#diagnostics-and-error-recovery) while still keeping the grammar-like structure.

## Parsing dice notation

Dice notation is used in some tabletop games to define which dice the player should roll. We will look at a simplified version with two numbers written like this `{number}d{number}` where the first number is the number of dice to roll and the second number is the number of sides these dice should have. Some examples could be `2d6` for rolling two dices with six sides each or `1d20` for rolling a single dice with 20 sides.

The grammar for this notation could look something like this:
```ebnf
NUMBER = '0'..'9', { '0'..'9' } ;

ROLL   = NUMBER, 'd', NUMBER ;
```

Let's try to parse this into the following rust struct:
```rust
struct Roll {
    count: u32,
    sides: u32,
}
```

> [!NOTE]
> You can find all implementations [here](https://github.com/ArneCode/parser-combinator-syntax-comparison)
> 
> I have used AI to help me write some of the implementations but this article is written completely by me.
> 
> If you think I have used code that is not idiomatic or have some other suggestions, please feel free to write a comment below
> or open a pull request to the implementation.
>
> 


### chumsky implementation
```rust
use chumsky::prelude::*;

type Err<'src> = extra::Err<Rich<'src, char>>;

pub fn number<'src>() -> impl Parser<'src, &'src str, u32, Err<'src>> {
    text::int(10).map(|s: &str| s.parse::<u32>()).unwrapped()
}

pub fn roll<'src>() -> impl Parser<'src, &'src str, Roll, Err<'src>> {
    number()
        .then_ignore(just('d'))
        .then(number())
        .map(|(count, sides)| Roll { count, sides })
}
```

Note the use of `x.then_ignore(y)` which parses `x` and then `y`, but only returns the output of `x` and `x.then(y)` which parses `x` and then `y` and returns a tuple of the results of both. 

### nom implementation
```rust
use nom::{IResult, Parser, bytes::complete::tag, character::complete::u32};

pub fn roll(input: &str) -> IResult<&str, Roll> {
    (
        u32,
        tag("d"),
        u32,
    )
        .map(|(count, _, sides)| Roll { count, sides })
        .parse(input)
}
```

### marser implementation
```rust
use marser::capture;
use marser::matcher::one_or_more;
use marser::parser::Parser;

fn number<'src>() -> impl Parser<'src, &'src str, Output = u32> {
    capture!(
        bind_slice!(
            one_or_more('0'..='9'),
            number_slice as &'src str
        )
        =>  number_slice 
                .parse() 
                .unwrap()
    )
}

fn roll<'src>() -> impl Parser<'src, &'src str, Output = Roll> {
    capture!(
        (
            bind!(number(), count), 
            'd',
            bind!(number(), sides) 
        )
        =>  Roll { count, sides }
    )
}
```

Marser separates between `Parsers` which consume input and return an output and `Matchers` which consume input and
write values into `capture buckets` which are defined using `bind!` statements. For example note `bind!(number(), count)` 
above which stores the result of `number()` in the `count` bucket. `Matchers` can then be used inside 
a `capture!` macro which uses the `capture buckets` of the matcher to construct some return value, 
defined after the `=>`. `bind_slice!` can be used to store a borrowed reference of whatever was matched inside into a bucket.

> [!NOTE]
> Under the hood, the `capture!` code for `roll` transforms into something like this:
> ```rust
> Capture::new(|(count_property, sides_property), (), ()|
>    (
>        bind_result(number(), count_property), 
>        'd',
>        bind_result(number(), sides_property) 
>    ),
>    |(count, sides), (), ()| Roll { count, sides }
>)
>```
> You can read more about capture / bind in the [marser guide](https://docs.rs/marser/latest/marser/guide/capture_and_binds/index.html)

## Parsing function signatures

We will now move to a slightly larger example, parsing a function signature grammar looking like this: 
```ebnf
IDENT        = 'a'..'z', { 'a'..'z' | '0'..'9' } ;

FN_SIGNATURE = 'fn', WHITESPACE, IDENT, WHITESPACE,
               '(', WHITESPACE,
                   [ IDENT, WHITESPACE, { ',', WHITESPACE, IDENT, WHITESPACE } ], 
               ')', WHITESPACE
               [ '->', WHITESPACE, IDENT ] ;
```

We will parse into this rust struct:
```rust
pub struct FnSignature<'src> {
    pub name: &'src str,
    pub args: Vec<&'src str>,
    pub return_type: Option<&'src str>,
}
```

### chumsky implementation
```rust
use chumsky::prelude::*;

type Err<'src> = extra::Err<Rich<'src, char>>;

pub fn ident<'src>() -> impl Parser<'src, &'src str, &'src str, Err<'src>> {
    one_of('a'..='z')
        .then(one_of('a'..='z').or(one_of('0'..='9')).repeated())
        .to_slice()
}

pub fn fn_signature<'src>() -> impl Parser<'src, &'src str, FnSignature<'src>, Err<'src>> {
    let args = ident()
        .padded()
        .separated_by(just(',').padded())
        .collect::<Vec<_>>()
        .delimited_by(just('(').padded(), just(')').padded());

    let return_type = just("->").padded().ignore_then(ident()).or_not();

    just("fn")
        .padded()
        .ignore_then(ident())
        .then(args)
        .then(return_type)
        .map(|((name, args), return_type)| FnSignature {
            name,
            args,
            return_type,
        })
}
```
Chumsky already has an identifier parser included in the library, but it has a slightly different definition to our grammar, so for the sake of comparison we are defining it new here.

### nom implementation
```rust
use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_while},
    character::complete::{char, multispace0, satisfy},
    combinator::{opt, recognize},
    error::Error,
    multi::separated_list0,
    sequence::{delimited, preceded},
};

fn ws<'a, O>(
    parser: impl Parser<&'a str, Output = O, Error = Error<&'a str>>,
) -> impl Parser<&'a str, Output = O, Error = Error<&'a str>> {
    delimited(multispace0, parser, multispace0)
}

fn ident(input: &str) -> IResult<&str, &str> {
    recognize((
        satisfy(|c: char| c.is_ascii_alphabetic()),
        take_while(|c: char| c.is_ascii_alphanumeric()),
    ))
    .parse(input)
}

pub fn fn_signature(input: &str) -> IResult<&str, FnSignature<'_>> {
    (
        preceded(ws(tag("fn")), ws(ident)),
        delimited(
            ws(char('(')),
            separated_list0(ws(char(',')), ws(ident)),
            ws(char(')')),
        ),
        opt(preceded(ws(tag("->")), ident)),
    )
        .map(|(name, args, return_type)| FnSignature {
            name,
            args,
            return_type,
        })
        .parse(input)
}
```
Note the use of `preceded` which runs two parsers but only keeps the result of the second one and `delimited` which runs three parsers but only keeps the result of the middle one.

### marser implementation
```rust
use marser::{
    capture,
    matcher::{Matcher, many, optional},
    one_of::one_of,
    parser::Parser,
};

pub fn ident<'src>() -> impl Parser<'src, &'src str, Output = &'src str> {
    capture!((
        bind_slice!(
            (
                'a'..='z',
                many(one_of(('a'..='z', '0'..='9')))
            ),
            slice as &'src str
        ),
        whitespace()
        )
        => slice
    )
}

pub fn whitespace<'src, MRes>() -> impl Matcher<'src, &'src str, MRes> {
    many(one_of((' ', '\t', '\n', '\r')))
}

pub fn fn_signature<'src>() -> impl Parser<'src, &'src str, Output = FnSignature<'src>> {
    capture!(
        (
            "fn",
            whitespace(),
            bind!(ident(), name),
            "(",
            whitespace(),
            optional((
                bind!(ident(), *args),
                many((
                    ",",
                    whitespace(),
                    bind!(ident(), *args),
                ))
            )),
            ")",
            whitespace(),
            optional((
                "->",
                whitespace(),
                bind!(ident(), ?return_type)
            ))
        )
        =>
            FnSignature { name, args, return_type }
    )
}
```

In the code above you can see that `bind!` supports different bucket types. `bind!(ident(), *args)` means that `args` will be accumulated in a `Vec` and `bind!(ident(), ?return_type)` means that `return_type` will be stored in an `Option`.

## What does Grammar first mean?

Being a grammar-first parsing library means that marser allows its users to write parsing code closely resembling the structure of grammar rules. You can take the grammars from above and map them almost one to one to the marser code. This has a couple advantages but also disadvantages.

#### Reasons not to use grammar-first syntax like this

Using something like the `capture!` hides some of the parser mechanics away from you. Transforming code using the `capture!` macro means that you give away control over the actual shape of your code.
Traditional parser-combinator syntax is already well known and understood by many poeple, switching requires a new framework. 

#### Advantages to grammar-first syntax

I believe that writing parsers that are close to grammar rules makes code easier to reason about. You can quickly go from
a formal grammar to a parser. Also I think that the capture / bind syntax simplifies the output of values a lot, because you don't
need to write what to ignore with `then_ignore` or `delimited`, but you just write what you use. It allows you to tackle Grammar and output generation as two separate problems. Which I believe reduces complexity.

As a bonus you can also tie in error recovery into this while still keeping the parsers readable.


## Diagnostics and error recovery
We will now look at how we could make the marser parser for the function signature code above more resilient to errors.

One error that users of the parser could make is forgetting some part of the input. For example they could
write something like `fn f(a, b c -> int`. Here we can use a marser method called `.try_insert_if_missing(error_msg)`.
We can change the function signature code to:
```rust
capture!(
    (
        "fn",
        whitespace(),
        bind!(ident(), name),
        "(",
        whitespace(),
        optional((
            bind!(ident(), *args),
            many((
                ",".try_insert_if_missing("missing comma"), // added here
                whitespace(),
                bind!(ident(), *args),
            ))
        )),
        ")".try_insert_if_missing("missing closing bracket"), // and here
        whitespace(),
        optional((
            "->",
            whitespace(),
            bind!(ident(), ?return_type)
        ))
    )
    =>  FnSignature { name, args, return_type }
)
```
> [!NOTE]
> For this example to run you need to additionally import the `MatcherCombinator` trait from marser

Now running the broken signature from above gives us:
```
error: Parse Errors
 --> examples/data/invalid_signature1:1:11
  |
1 | fn f(a, b c -> int
  |           ^ - missing closing bracket
  |           |
  |           missing comma
```

We can also include information from the binds into the error message. For example we can do this to add extra
information to the "missing closing bracket" error:
```rust
capture!(
    (
        "fn",
        whitespace(),
        bind!(ident(), name),
        bind_span!("(", open_bracket_span), // added here
        whitespace(),
        optional((
            /*
            ...
            */
        )),
        ")".err_if_no_match(use_binds!(|ctx| { // and here
            let open_bracket_span: Option<(usize, usize)> = open_bracket_span.copied();
            InlineError::new("missing closing ')'")
                .with_span(Some(ctx.span()))
                .with_annotation(
                    open_bracket_span.unwrap(),
                    "bracket opened here",
                    AnnotationKind::Context,
                )
        })),
        //...
    )
    =>  FnSignature { name, args, return_type }
)
```

Note the use of `bind_span!` it works like `bind_slice!` but stores the start and end positions of the matched text. 

> [!NOTE]
> For this example you need to additionally import `InlineError` and `AnnotationKind`

Now we get this error message:
```
error: Parse Errors
 --> examples/data/invalid_signature1:1:11
  |
1 | fn f(a, b c -> int
  |     -     ^ - missing closing ')'
  |     |     |
  |     |     missing comma
  |     bracket opened here
```



The user could also write something like `fn f(a, , c)`. To handle cases like this we can use the `unwanted(matcher, error_msg)` syntax:
```rust
capture!(
    (
        "fn",
        whitespace(),
        bind!(ident(), name),
        bind_span!("(", open_bracket_span),
        whitespace(),
        many((unwanted(',', "missing element"), whitespace())), // added here
        optional((
            bind!(ident(), *args),
            many((
                ",".try_insert_if_missing("missing comma"),
                whitespace(),
                many((unwanted(',', "missing element"), whitespace())), // and here
                bind!(ident(), *args),
            )),
            many((unwanted(',', "missing element"), whitespace())), // and here
        )),
        ")"//.err_if_no_match...
    )
    =>  FnSignature { name, args, return_type }
)
```

Now when inputting `fn f(a, , c)`, we get:
```
error: Parse Errors
 --> examples/data/invalid_signature2:1:9
  |
1 | fn f(a, , c)
  |         ^ missing element
```

> [!NOTE]
> There are a couple of other strategies for error recovery and adding more information to errors. 
> You can read about it [here](https://docs.rs/marser/latest/marser/guide/errors_and_recovery/index.html)

## Conclusion

Now that we have discussed what grammar-first means for marser and how to use it, we will discuss its advantages and disadvantages.
As the author of the library I am of course biased so please write in the comments below if you disagree!

#### Reasons not to use marser

Marser is still very new. At the time of writing this article, I have just released it last week. That said, I expect the 
overall syntax to stay pretty consistent. This means that it hasn't seen much use yet. The documentation is currently largely AI-generated,
but I am working on it.

#### Reasons to use marser

Marser is designed to be easy to get into if you already know formal grammars (EBNF, PEG etc.). It has good support for error recovery
and error diagnostics. It supports features like packrat-style caching, multiple input types (&str, &[u8] etc.), has zero-copy parsing support
and has a custom TUI for debugging your parsers.

### Interested?

If this post interested you, you can check it out [here](https://github.com/ArneCode/marser) or add it to you project using:
```bash
cargo add marser
```

This is my first post as well as my first library I am publishing, so if you have any suggestions, please feel free to write a comment
down below or [open an issue](https://github.com/ArneCode/marser/issues/new) on the project.

Thank you for reading this far!