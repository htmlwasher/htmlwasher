#!/usr/bin/env bash
#
# clone-other-repos.sh
# =============================================================================
# Clones the SOURCE repositories used as references for building a TypeScript
# fork/port of rs-trafilatura ("htmlwasher").
#
# WHY THIS SCRIPT EXISTS
# -----------------------------------------------------------------------------
# rs-trafilatura is a *divergent* fork sitting on top of a well-documented
# lineage. The faithful core extraction logic is far better explained upstream
# than in the fork itself, so we clone the whole chain and assign each repo an
# explicit ROLE/AUTHORITY. The dependency lineage is:
#
#     adbar/trafilatura   (Python, the canonical original)
#            |
#            v
#     markusmobius/go-trafilatura   (faithful near line-by-line Go port)
#            |
#            +-------------> nchapman/trafilatura-rs   (faithful Rust port)
#            |
#            v
#     Murrough-Foley/rs-trafilatura  (DIVERGENT Rust fork: + ML page-typing)
#            |  '-- Murrough-Foley/web-page-classifier (the XGBoost classifier)
#            v
#     htmlwasher   (OUR TypeScript fork, built under r/htmlwasher/)
#
# AUTHORITY HIERARCHY when sources disagree:
#   1. rs-trafilatura + web-page-classifier define *WHAT* to build
#      (page-type-aware architecture, per-type extraction profiles,
#      confidence scoring, the 181-feature classifier).
#   2. go-trafilatura + adbar/trafilatura define *HOW extraction should behave*
#      (the heuristics, fallback cascade, metadata rules, edge cases).
#      When rs-trafilatura is thinly documented or ambiguous, DEFER to
#      go-trafilatura's logic and adbar's documented semantics.
#   3. nchapman/trafilatura-rs is a cross-check / tiebreaker.
#   4. mozilla/readability is a TypeScript/DOM idiom reference only (not
#      Trafilatura), for structuring DOM traversal cleanly in JS/TS.
#
# LICENSES (verify before reusing code/data):
#   - rs-trafilatura ......... MIT OR Apache-2.0
#   - web-page-classifier .... MIT OR Apache-2.0
#   - go-trafilatura ......... Apache-2.0
#   - adbar/trafilatura ...... Apache-2.0
#   - nchapman/trafilatura-rs  MIT OR Apache-2.0 (check repo)
#   - mozilla/readability .... Apache-2.0
#   - WCXB training dataset .. CC-BY-4.0 (attribution REQUIRED; not cloned here,
#                              it lives on Zenodo / Hugging Face)
#
# BRANCH POLICY
# -----------------------------------------------------------------------------
# The task asks to switch to "the most recent branch (e.g. dev)". Different
# repos use different conventions, so for each repo we PREFER a development
# branch if one exists (dev -> develop -> development -> next), and otherwise
# fall back to the remote's default branch (main/master). The script prints
# which branch it landed on, and also reports the most-recently-updated remote
# branch as INFO so you can manually switch to a bleeding-edge feature branch if
# you want to.
#
# USAGE
# -----------------------------------------------------------------------------
#   chmod +x clone-other-repos.sh
#   ./clone-other-repos.sh
#
# The script is IDEMPOTENT: if a repo is already cloned it fetches and re-checks
# out the chosen branch instead of failing. Re-run it any time to refresh.
#
# IMPORTANT: repos are cloned into a dedicated SOURCES directory that lives
# OUTSIDE this repository, as a SIBLING of it (never a subfolder of the product
# repo):
#   ~/r/htmlwasher-sources/        (i.e. ../htmlwasher-sources relative to this script)
# This keeps the six reference repos completely out of the product repo (which
# holds the clone script, prompts/, tools/, and the htmlwasher library). They
# are NOT cloned inside the repo and NOT into the current working directory.
# =============================================================================

set -euo pipefail

# --- Where to clone -----------------------------------------------------------
# All reference repos go into a "htmlwasher-sources/" directory that is a SIBLING
# of this repo (OUTSIDE it), never a subfolder of the product repo. Derived
# script-relative so no username is baked in and it follows the script if moved:
# it resolves to "<dir-of-this-script>/../htmlwasher-sources".
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/htmlwasher-sources"

# Candidate "development" branch names, in order of preference.
PREFERRED_BRANCHES=("dev" "develop" "development" "next")

mkdir -p "$BASE_DIR"

# --- Pretty logging helpers ---------------------------------------------------
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    \033[2m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

# -----------------------------------------------------------------------------
# pick_and_checkout_branch <repo_dir>
#   Fetches all remotes, then checks out the first existing PREFERRED branch,
#   falling back to the remote default HEAD. Prints the branch it landed on and
#   reports the newest remote branch as info.
# -----------------------------------------------------------------------------
pick_and_checkout_branch() {
  local repo_dir="$1"

  git -C "$repo_dir" fetch --all --tags --prune --quiet || warn "fetch failed for $repo_dir"

  # Try each preferred development branch name.
  local b
  for b in "${PREFERRED_BRANCHES[@]}"; do
    if git -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$b"; then
      git -C "$repo_dir" checkout -q "$b" 2>/dev/null \
        || git -C "$repo_dir" checkout -q -b "$b" "origin/$b"
      git -C "$repo_dir" pull --ff-only --quiet || true
      log "  -> on development branch: $b"
      _report_newest_branch "$repo_dir"
      return 0
    fi
  done

  # Fall back to the remote's default branch (main/master/etc).
  local def
  def="$(git -C "$repo_dir" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
  if [ -z "${def:-}" ]; then
    # Older git or missing origin/HEAD: derive it explicitly.
    def="$(git -C "$repo_dir" remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p' | head -n1 || true)"
  fi
  if [ -n "${def:-}" ]; then
    git -C "$repo_dir" checkout -q "$def"
    git -C "$repo_dir" pull --ff-only --quiet || true
    log "  -> no dev branch found; on default branch: $def"
  else
    warn "  -> could not determine a branch to check out"
  fi
  _report_newest_branch "$repo_dir"
}

# Informational only: shows the most recently committed remote branch so you can
# manually `git checkout` it if you want the absolute latest work. We do NOT
# auto-switch to it, because it is often a throwaway feature branch.
_report_newest_branch() {
  local repo_dir="$1"
  local newest
  newest="$(git -C "$repo_dir" for-each-ref --sort=-committerdate \
            --format='%(refname:short)  (%(committerdate:relative))' \
            refs/remotes/origin 2>/dev/null \
            | grep -v 'origin/HEAD' | head -n1 || true)"
  [ -n "${newest:-}" ] && info "newest remote branch: ${newest}"
}

# -----------------------------------------------------------------------------
# clone_repo <git_url> <target_folder_name>
#   Clones into $BASE_DIR/<target_folder_name> (absolute path, cwd-independent).
#   Idempotent: re-fetches if it already exists.
# -----------------------------------------------------------------------------
clone_repo() {
  local url="$1"
  local name="$2"
  local dest="$BASE_DIR/$name"

  if [ -d "$dest/.git" ]; then
    log "$name already cloned -- refreshing ($dest)"
  else
    log "Cloning $name into $dest"
    git clone "$url" "$dest"
  fi
  pick_and_checkout_branch "$dest"
  echo
}

# =============================================================================
# THE SOURCE REPOSITORIES
# =============================================================================

# -----------------------------------------------------------------------------
# 1) Murrough-Foley/rs-trafilatura      [PRIMARY PORT TARGET -- must]
# -----------------------------------------------------------------------------
# This is the project we are forking to TypeScript. Use it as the blueprint for
# the page-type-aware ARCHITECTURE: the URL->HTML->ML classification cascade, the
# per-page-type extraction profiles, the confidence scoring, and how the
# classifier output is wired into the extraction pipeline. It is a *divergent*
# fork, so treat its extraction internals as "intent" and validate the actual
# heuristics against go-trafilatura / adbar (see #3, #4).
clone_repo "https://github.com/Murrough-Foley/rs-trafilatura.git" "rs-trafilatura"

# -----------------------------------------------------------------------------
# 2) Murrough-Foley/web-page-classifier  [THE CLASSIFIER -- must]
# -----------------------------------------------------------------------------
# The standalone crate that rs-trafilatura depends on for page typing. This is
# where the ML actually lives: the 181 features (81 numeric DOM/URL signals +
# 100 TF-IDF terms), the 7 page types (article, forum, product, collection,
# listing, documentation, service), the 3-stage cascade, and the embedded
# ~1.1MB model. PORT THE FEATURE EXTRACTION FROM HERE BYTE-FOR-BYTE -- feature
# parity is the hard part; if features drift, predictions diverge.
clone_repo "https://github.com/Murrough-Foley/web-page-classifier.git" "web-page-classifier"

# -----------------------------------------------------------------------------
# 3) markusmobius/go-trafilatura        [FAITHFUL CORE REFERENCE -- must]
# -----------------------------------------------------------------------------
# A near line-by-line Go port of the Python original and the cleanest, most
# readable source for the ACTUAL extraction algorithm: the heuristics, the
# fallback cascade (readability/dom-distiller equivalents), comment and table
# handling. This is the DISAMBIGUATOR: when rs-trafilatura's logic is unclear,
# port the behavior from here.
clone_repo "https://github.com/markusmobius/go-trafilatura.git" "go-trafilatura"

# -----------------------------------------------------------------------------
# 4) adbar/trafilatura                  [CANONICAL ORIGINAL -- must]
# -----------------------------------------------------------------------------
# The reference implementation everything descends from. Use it for ground-truth
# SEMANTICS of every extraction option, metadata extraction rules, and edge
# cases -- and, importantly, for its TEST CORPUS and expected outputs, which we
# will reuse as the validation harness for the TS fork ("done" = matches
# reference output on real pages, not just "compiles").
clone_repo "https://github.com/adbar/trafilatura.git" "trafilatura"

# -----------------------------------------------------------------------------
# 5) nchapman/trafilatura-rs            [CROSS-CHECK / TIEBREAKER -- nice-to-have]
# -----------------------------------------------------------------------------
# An independent, faithful Rust port of go-trafilatura (with multi-language
# UniFFI bindings). Useful as a second faithful reading to cross-check tricky
# logic and to see how Rust idioms map back to portable, language-neutral logic
# when translating into TypeScript.
clone_repo "https://github.com/nchapman/trafilatura-rs.git" "trafilatura-rs"

# -----------------------------------------------------------------------------
# 6) mozilla/readability                [TS/DOM IDIOM REFERENCE -- nice-to-have]
# -----------------------------------------------------------------------------
# NOT Trafilatura and a different algorithm (Readability), but the canonical
# example of doing readable-content extraction *in JavaScript against a real
# DOM*. Reference for how to structure DOM traversal idiomatically in TS
# (pairs well with linkedom / parse5 / cheerio on the Node side).
clone_repo "https://github.com/mozilla/readability.git" "readability"

# -----------------------------------------------------------------------------
# 7) (OPTIONAL) Prior JS translation of Trafilatura   [PRIOR ART -- disabled]
# -----------------------------------------------------------------------------
# A community JavaScript translation of Trafilatura was posted in
# adbar/trafilatura issue #688 (by "vtempest"). It was never adopted upstream
# and is unmaintained, so treat it as a sketch / "what's been tried", not a
# source of truth. The exact repo URL is UNVERIFIED -- confirm it before
# enabling. Uncomment and fix the URL if you want it as extra prior art.
#
# clone_repo "https://github.com/vtempest/trafilatura-js.git" "trafilatura-js"

# =============================================================================
log "All done. Reference repositories are under: $BASE_DIR"
info "Reminder: the WCXB training dataset (CC-BY-4.0) is NOT cloned here --"
info "fetch it from Zenodo (DOI 10.5281/zenodo.19316874) or Hugging Face"
info "(murrough-foley/web-content-extraction-benchmark) if you retrain the model."
