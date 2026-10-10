// Small DOM helpers shared by every module.
export const $ = (selector) => document.querySelector(selector);

// Model output is untrusted, so every string goes in as text, never as HTML.
export const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("data-") || key.startsWith("aria-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter(Boolean));
  return node;
};

export const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
export const quote = (value) => `“${value}”`;

// Models write Markdown; the page shows plain text, so drop the emphasis marks.
export const plain = (text) => String(text ?? "").replace(/\*\*|__|`/g, "");
