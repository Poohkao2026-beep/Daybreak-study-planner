export function element(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
  }
  return node;
}

export function button(text, action, options = {}) {
  const node = element("button", {
    className: options.className || "button button-quiet",
    text,
    attrs: { type: "button", "data-action": action, "aria-label": options.label },
  });
  if (options.disabled) node.disabled = true;
  return node;
}

export function field(labelText, control, hint = "") {
  const wrapper = element("label", { className: "field" });
  wrapper.append(element("span", { text: labelText }));
  wrapper.append(control);
  if (hint) wrapper.append(element("small", { text: hint }));
  return wrapper;
}

export function input(options = {}) {
  return element("input", { className: "input", attrs: { type: options.type || "text", name: options.name, value: options.value, placeholder: options.placeholder, required: options.required, min: options.min, max: options.max, step: options.step, maxlength: options.maxlength, "aria-describedby": options.describedBy } });
}

export function select(options, selected) {
  const control = element("select", { className: "input" });
  for (const option of options) {
    const item = element("option", { text: option.label, attrs: { value: option.value } });
    item.selected = option.value === selected;
    control.append(item);
  }
  return control;
}

export function screenTitle(kicker, title, description) {
  const wrapper = element("div", { className: "screen-title" });
  wrapper.append(element("p", { className: "eyebrow", text: kicker }));
  wrapper.append(element("h2", { text: title }));
  if (description) wrapper.append(element("p", { className: "prose", text: description }));
  return wrapper;
}
