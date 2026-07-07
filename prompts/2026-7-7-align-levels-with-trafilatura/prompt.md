we need to remove this settings:
```
export const CLEANING_LEVELS = ['minimal', 'standard', 'permissive', 'styled', 'correct'] as const;
export type CleaningLevel = (typeof CLEANING_LEVELS)[number];

```
we will keep only those elements what the the trafilatura or rs-trafilatura does ()ressearcj on the web and in /Users/miroslavsekera/r/trafilatura-sources

also, rename the `none` in below to something better , to reflect that it will do only the html cleanup by filtering to basic elements, but keeping only basic elements
```
export const BOILERPLATE_MODES = ['precision', 'balanced', 'recall', 'none'] as const;
export type BoilerplateMode = (typeof BOILERPLATE_MODES)[number];
```

update /Users/miroslavsekera/r/trafilatura/SPEC.md
update /Users/miroslavsekera/r/trafilatura/prompts/2026-6-24-init/prompt.md
update /Users/miroslavsekera/r/trafilatura/README.md

when done, commit and push
then  run thsi slash command `/bench:improve`
then again commit and push
