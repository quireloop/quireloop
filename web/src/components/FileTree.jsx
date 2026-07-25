import { useRef, useState } from 'react';
import { buildTree } from '../lib/fileTree.js';

function FolderNode({ node, activePath, dirty, collapsed, onToggle, depth, readOnly, selected, onToggleSelect, ...handlers }) {
  const isCollapsed = collapsed.has(node.path);
  return (
    <div>
      <div
        style={{
          padding: '6px 8px',
          paddingLeft: 8 + depth * 14,
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {!readOnly && (
          <input
            type="checkbox"
            checked={selected.has(node.path)}
            onChange={() => onToggleSelect(node.path)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0 }}
          />
        )}
        <span onClick={() => onToggle(node.path)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <span>{isCollapsed ? '▶' : '▼'}</span> {node.name}/
        </span>
      </div>
      {!isCollapsed &&
        node.children.map((child) =>
          child.type === 'folder' ? (
            <FolderNode
              key={child.path}
              node={child}
              activePath={activePath}
              dirty={dirty}
              collapsed={collapsed}
              onToggle={onToggle}
              depth={depth + 1}
              readOnly={readOnly}
              selected={selected}
              onToggleSelect={onToggleSelect}
              {...handlers}
            />
          ) : (
            <FileRow
              key={child.path}
              file={child}
              activePath={activePath}
              dirty={dirty}
              depth={depth + 1}
              readOnly={readOnly}
              selected={selected}
              onToggleSelect={onToggleSelect}
              {...handlers}
            />
          )
        )}
    </div>
  );
}

function FileRow({ file, activePath, dirty, depth, readOnly, selected, onToggleSelect, onSelect, onRename, onDelete }) {
  function handleRename(e) {
    e.stopPropagation();
    const name = prompt('Rename to:', file.path);
    if (name && name.trim() && name.trim() !== file.path) onRename(file.path, name.trim());
  }

  function handleDelete(e) {
    e.stopPropagation();
    if (confirm(`Delete ${file.path}?`)) onDelete(file.path);
  }

  return (
    <div
      onClick={() => onSelect(file)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 8px',
        paddingLeft: 8 + depth * 14,
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        background: file.path === activePath ? 'var(--accent-bg)' : 'transparent',
        fontSize: 13,
      }}
    >
      {!readOnly && (
        <input
          type="checkbox"
          checked={selected.has(file.path)}
          onChange={() => onToggleSelect(file.path)}
          onClick={(e) => e.stopPropagation()}
          style={{ margin: 0 }}
        />
      )}
      <span style={{ flex: 1, wordBreak: 'break-all' }}>
        {file.name}
        {file.path === activePath && dirty && <span title="Unsaved changes"> •</span>}
      </span>
      {!readOnly && (
        <>
          <button onClick={handleRename} title="Rename" style={{ fontSize: 11, padding: '1px 4px' }}>
            ✎
          </button>
          <button onClick={handleDelete} title="Delete" style={{ fontSize: 11, padding: '1px 4px', color: 'crimson' }}>
            ×
          </button>
        </>
      )}
    </div>
  );
}

export default function FileTree({
  files,
  activePath,
  dirty,
  readOnly,
  onSelect,
  onUpload,
  onCreate,
  onCreateFolder,
  onRename,
  onDelete,
  onDeleteMany,
}) {
  const fileInputRef = useRef(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const tree = buildTree(files);

  function toggleFolder(path) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleSelect(path) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleFileChosen(e) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of chosen) await onUpload(file);
  }

  function handleCreate() {
    const name = prompt('New file name (e.g. section2.tex):');
    if (name) onCreate(name.trim());
  }

  function handleCreateFolder() {
    const name = prompt('New folder name (e.g. figures):');
    if (name) onCreateFolder(name.trim());
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    const dropped = Array.from(e.dataTransfer.files ?? []);
    for (const file of dropped) await onUpload(file);
  }

  async function handleDeleteSelected() {
    const paths = [...selected];
    if (paths.length === 0) return;
    if (!confirm(`Delete ${paths.length} item${paths.length > 1 ? 's' : ''}?`)) return;
    await onDeleteMany(paths);
    setSelected(new Set());
  }

  return (
    <div
      onDragOver={(e) => {
        if (readOnly) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        padding: 8,
        overflowY: 'auto',
        height: '100%',
        background: dragOver ? 'var(--accent-bg)' : 'transparent',
      }}
    >
      {selected.size > 0 && !readOnly ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 8px', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.size} selected</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={handleDeleteSelected} style={{ fontSize: 12, padding: '2px 8px', color: 'crimson' }}>
              Delete
            </button>
            <button onClick={() => setSelected(new Set())} style={{ fontSize: 12, padding: '2px 8px' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 8px', gap: 4 }}>
          <h4 style={{ margin: 0 }}>Files</h4>
          {!readOnly && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={handleCreate} style={{ fontSize: 12, padding: '2px 8px' }}>
                + New
              </button>
              <button onClick={handleCreateFolder} style={{ fontSize: 12, padding: '2px 8px' }}>
                + Folder
              </button>
              <button onClick={() => fileInputRef.current.click()} style={{ fontSize: 12, padding: '2px 8px' }}>
                Upload
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChosen}
            style={{ display: 'none' }}
            accept=".png,.jpg,.jpeg,.pdf,.bib"
          />
        </div>
      )}
      {tree.map((node) =>
        node.type === 'folder' ? (
          <FolderNode
            key={node.path}
            node={node}
            activePath={activePath}
            dirty={dirty}
            collapsed={collapsed}
            onToggle={toggleFolder}
            depth={0}
            readOnly={readOnly}
            selected={selected}
            onToggleSelect={toggleSelect}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ) : (
          <FileRow
            key={node.path}
            file={node}
            activePath={activePath}
            dirty={dirty}
            depth={0}
            readOnly={readOnly}
            selected={selected}
            onToggleSelect={toggleSelect}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        )
      )}
    </div>
  );
}
