"""ComfyUI-TraceLinks.

A frontend-only ComfyUI extension that dims or hides node links by their data
type, so you can trace a single path (e.g. only IMAGE) through a busy workflow.

There are no Python nodes and no server-side code: this package only points
ComfyUI at the ``web`` directory that holds the JavaScript extension.
"""

# Serve the JS/CSS extension. ComfyUI loads every .js file found here as a
# frontend extension module.
WEB_DIRECTORY = "./web"

# No custom nodes are defined by this pack.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
