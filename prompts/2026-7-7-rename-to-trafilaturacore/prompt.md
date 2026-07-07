
we renamed those repos from
```
/Users/miroslavsekera/r/htmlwasher/
/Users/miroslavsekera/r/htmlwasher-external-tester
``
to
```
/Users/miroslavsekera/r/trafilatura/
/Users/miroslavsekera/r/trafilatura-external-tester
``

Now, in those renamed repositories
```
/Users/miroslavsekera/r/trafilatura/
/Users/miroslavsekera/r/trafilatura-external-tester
``

we also need to rename packages and packame names folder
so rename all package names, folders, names, references in package.json turborepo config, crate config etc

repo name, already renamed  `htmlwasher` to `trafilatura`, `htmlwasher-external-tester` renamed to `trafilatura-external-tester`
package name, subfolders (except repo foolder) `htmlwasher` to `trafilaturacore` (without dash),
display name `HTML Washer` to `Trafilatura Core`,
the npm package will be naned `trafilaturacore`