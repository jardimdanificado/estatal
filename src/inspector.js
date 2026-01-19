export function openInspectorWindow(target, options = {}) {
    if (!target) return null;
    const {
        title = 'Inspector',
        windowName = 'object-inspector',
        width = 520,
        height = 720,
        onChange = null
    } = options;

    window.__INSPECTOR_TARGET__ = target;
    window.__INSPECTOR_TITLE__ = title;
    window.__INSPECTOR_ON_CHANGE__ = typeof onChange === 'function' ? onChange : null;
    const win = window.open('', windowName, `width=${width},height=${height}`);
    if (!win) {
        console.warn('Popup blocked.');
        return null;
    }
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Inspector</title>
  <style>
    body { margin: 0; font-family: "Courier New", monospace; background: #0e0e0e; color: #fff; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.15); }
    #title { font-weight: bold; }
    #content { padding: 10px 12px; height: calc(100vh - 52px); overflow: auto; }
    button { padding: 6px 10px; font-family: "Courier New", monospace; font-size: 12px; background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; }
    .row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .label { min-width: 120px; color: #f0d7a1; }
    .obj { cursor: pointer; color: #9fd3ff; user-select: none; display: inline-flex; align-items: center; gap: 6px; }
    .arrow { width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid #9fd3ff; display: inline-block; transition: transform 0.12s ease; }
    .arrow[data-open="true"] { transform: rotate(90deg); }
    input[type="text"] { flex: 1; background: rgba(255,255,255,0.08); color: white; border: 1px solid rgba(255,255,255,0.2); padding: 4px 6px; font-family: "Courier New", monospace; font-size: 12px; }
    input[data-pending="true"] { border-color: #f0d7a1; box-shadow: 0 0 0 1px rgba(240,215,161,0.4); }
  </style>
</head>
<body>
  <header>
    <div id="title">Inspector</div>
    <div>
      <label style="margin-right: 8px; font-size: 12px;">
        <input id="hotreload" type="checkbox" checked style="vertical-align: middle; margin-right: 4px;">
        Hot reload
      </label>
      <button id="apply">Apply</button>
      <button id="refresh">Refresh</button>
      <button id="close">Close</button>
    </div>
  </header>
  <div id="content"></div>
  <script>
    const content = document.getElementById('content');
    const title = document.getElementById('title');
    const refreshBtn = document.getElementById('refresh');
    const closeBtn = document.getElementById('close');
    const applyBtn = document.getElementById('apply');
    const hotReloadToggle = document.getElementById('hotreload');
    const pendingChanges = new Map();

    function getTarget() {
      return window.opener && window.opener.__INSPECTOR_TARGET__;
    }

    function getTitle() {
      return window.opener && window.opener.__INSPECTOR_TITLE__;
    }

    function pathKey(path) {
      return path.join('\u0000');
    }

    function setValueForPath(path, value) {
      const target = getTarget();
      if (!target || !path.length) return;
      let ref = target;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (ref && typeof ref === 'object') ref = ref[key];
        else return;
      }
      const lastKey = path[path.length - 1];
      if (ref && typeof ref === 'object') ref[lastKey] = value;
      const onChange = window.opener && window.opener.__INSPECTOR_ON_CHANGE__;
      if (typeof onChange === 'function') {
        try {
          onChange(path, value, target);
        } catch (err) {
          console.warn('Inspector onChange error:', err);
        }
      }
    }

    function handleChange(path, value, inputEl) {
      if (hotReloadToggle && hotReloadToggle.checked) {
        if (inputEl) inputEl.dataset.pending = 'false';
        pendingChanges.delete(pathKey(path));
        setValueForPath(path, value);
        return;
      }
      if (inputEl) inputEl.dataset.pending = 'true';
      pendingChanges.set(pathKey(path), { path, value, inputEl });
    }

    function applyPendingChanges() {
      for (const entry of pendingChanges.values()) {
        setValueForPath(entry.path, entry.value);
        if (entry.inputEl) entry.inputEl.dataset.pending = 'false';
      }
      pendingChanges.clear();
    }

    function renderRow(container, value, path, isReadOnly) {
      const wrapper = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = path.length ? path[path.length - 1] : '(root)';
      row.appendChild(label);
      const type = typeof value;
      if (type === 'function') {
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        const fnContainer = document.createElement('div');
        fnContainer.style.display = 'none';
        fnContainer.style.margin = '6px 0 6px 120px';
        const textarea = document.createElement('textarea');
        textarea.value = value.toString();
        textarea.style.width = 'calc(100% - 12px)';
        textarea.style.minHeight = '120px';
        textarea.style.background = 'rgba(255,255,255,0.08)';
        textarea.style.color = 'white';
        textarea.style.border = '1px solid rgba(255,255,255,0.2)';
        textarea.style.padding = '6px';
        textarea.style.fontFamily = '"Courier New", monospace';
        textarea.style.fontSize = '12px';
        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.marginTop = '6px';
        applyBtn.onclick = () => {
          try {
            const text = textarea.value;
            const fn = (new Function('return (' + text + ')'))();
            if (typeof fn !== 'function') throw new Error('Not a function');
            handleChange(path, fn);
          } catch (err) {
            console.warn('Invalid function:', err);
          }
        };
        editBtn.onclick = () => {
          const open = fnContainer.style.display === 'block';
          fnContainer.style.display = open ? 'none' : 'block';
          editBtn.textContent = open ? 'Edit' : 'Close';
        };
        row.appendChild(editBtn);
        fnContainer.appendChild(textarea);
        fnContainer.appendChild(applyBtn);
        wrapper.appendChild(row);
        wrapper.appendChild(fnContainer);
        container.appendChild(wrapper);
        return;
      }
      if (isReadOnly || value === null || type === 'undefined') {
        const text = document.createElement('div');
        text.textContent = String(value);
        text.style.color = '#bbb';
        row.appendChild(text);
        wrapper.appendChild(row);
        container.appendChild(wrapper);
        return;
      }
      if (type === 'boolean') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value;
        input.onchange = () => handleChange(path, input.checked, input);
        row.appendChild(input);
        wrapper.appendChild(row);
        container.appendChild(wrapper);
        return;
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(value);
      input.onchange = () => {
        let next = input.value;
        if (type === 'number') {
          const parsed = Number(next);
          if (!Number.isNaN(parsed)) next = parsed;
          else return;
        }
        handleChange(path, next, input);
      };
      row.appendChild(input);
      wrapper.appendChild(row);
      container.appendChild(wrapper);
    }

    function renderTree(container, value, path, depth, seen) {
      const maxDepth = 6;
      const isObject = value !== null && typeof value === 'object';
      if (!isObject || depth >= maxDepth) {
        renderRow(container, value, path);
        return;
      }
      if (seen.has(value)) {
        renderRow(container, '[circular]', path, true);
        return;
      }
      seen.add(value);
      const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value);
      for (const [key, val] of entries) {
        const wrapper = document.createElement('div');
        wrapper.style.marginLeft = (depth * 12) + 'px';
        wrapper.style.marginBottom = '4px';
        const isChildObject = val !== null && typeof val === 'object';
        if (isChildObject) {
          const header = document.createElement('div');
          const arrow = document.createElement('span');
          arrow.className = 'arrow';
          arrow.dataset.open = 'false';
          const preview = Array.isArray(val) ? (' [' + val.length + ']') : '';
          const label = document.createElement('span');
          label.textContent = key + preview;
          header.appendChild(arrow);
          header.appendChild(label);
          header.className = 'obj';
          const childContainer = document.createElement('div');
          childContainer.style.marginTop = '4px';
          childContainer.style.display = 'none';
          let expanded = false;
          header.onclick = () => {
            expanded = !expanded;
            childContainer.style.display = expanded ? 'block' : 'none';
            arrow.dataset.open = expanded ? 'true' : 'false';
            if (expanded && childContainer.childElementCount === 0) {
              renderTree(childContainer, val, path.concat(key), depth + 1, seen);
            }
          };
          wrapper.appendChild(header);
          wrapper.appendChild(childContainer);
        } else {
          renderRow(wrapper, val, path.concat(key));
        }
        container.appendChild(wrapper);
      }
    }

    function render() {
      const target = getTarget();
      content.innerHTML = '';
      const customTitle = getTitle();
      title.textContent = customTitle ? customTitle : 'Inspector';
      if (target && target.name && customTitle === 'Entity') {
        title.textContent = 'Entity: ' + target.name;
      }
      if (!target) {
        const empty = document.createElement('div');
        empty.textContent = 'No target.';
        content.appendChild(empty);
        return;
      }
      const seen = new WeakSet();
      renderTree(content, target, [], 0, seen);
    }

    hotReloadToggle.onchange = () => {
      if (hotReloadToggle.checked) {
        applyPendingChanges();
      }
    };
    applyBtn.onclick = applyPendingChanges;
    refreshBtn.onclick = render;
    closeBtn.onclick = () => window.close();
    render();
  </script>
</body>
</html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    return win;
}
