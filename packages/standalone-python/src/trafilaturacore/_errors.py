"""Typed exceptions for the trafilaturacore wrapper."""

from __future__ import annotations


class TrafilaturacoreError(Exception):
    """Base error for everything the wrapper raises."""


class NodeRuntimeError(TrafilaturacoreError):
    """The bundled Node runtime or CLI could not be located or executed."""
