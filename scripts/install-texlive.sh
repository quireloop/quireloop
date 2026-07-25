#!/usr/bin/env bash
# Installs the TeX Live packages Quireloop needs for a bare-metal (non-
# Docker) deployment: latexmk with all three engines (pdflatex/xelatex/
# lualatex) plus biber for modern bibliography support. Debian/Ubuntu only
# (apt-get) — this is the same package list the Dockerfile's runtime stage
# uses, kept in sync by hand since they can't share a build step.
#
# Deliberately excludes texlive-fonts-extra (~1.5GB of extra font
# families) and texlive-lang-* (non-Latin language packs) to keep the
# install lean — add them yourself below if your lab needs either, or run
# `sudo apt-get install texlive-full` instead for "everything".
set -euo pipefail

if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
  echo "error: run this as root, or install sudo first." >&2
  exit 1
fi

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "error: apt-get not found — this script is for Debian/Ubuntu." >&2
  echo "On other distros, install the equivalent of: texlive-latex-base," >&2
  echo "texlive-latex-recommended, texlive-latex-extra, texlive-fonts-recommended," >&2
  echo "texlive-xetex, texlive-luatex, texlive-bibtex-extra, biber, latexmk, git, unzip." >&2
  exit 1
fi

echo "Installing TeX Live + latexmk + biber (this can take a few minutes)..."
$SUDO apt-get update
$SUDO apt-get install -y --no-install-recommends \
  texlive-latex-base \
  texlive-latex-recommended \
  texlive-latex-extra \
  texlive-fonts-recommended \
  texlive-xetex \
  texlive-luatex \
  texlive-bibtex-extra \
  biber \
  latexmk \
  git \
  unzip

echo
echo "Done. Verify with:"
echo "  latexmk --version"
echo "  synctex version"
echo "  biber --version"
