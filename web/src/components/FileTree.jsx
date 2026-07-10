import { useRef, useState } from 'react';
import { buildTree } from '../lib/fileTree.js';

function FolderNode({ node, activePath, dirty, collapsed, onToggle, depth, ...handlers }) {
  const isCollapsed = collapsed.has(node.path);
  return (
    <div>
      <div
        onClick={() => onToggle(node.path)}
        style={{
          padding: '6px 8px',
          paddingLeft: 8 + depth * 14,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span>{isCollapsed ? '▶' : '▼'}</span> {node.name}/
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
              {...handlers}
            />
          ) : (
            <FileRow key={child.path} file={child} activePath={activePath} dirty={dirty} depth={depth + 1} {...handlers} />
          )
        )}
    </div>
  );
}

function FileRow({ file, activePath, dirty, depth, onSelect, onRename, onDelete }) {
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
        borderRadius: 4,
        background: file.path === activePath ? 'var(--accent-bg)' : 'transparent',
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1, wordBreak: 'break-all' }}>
        {file.name}
        {file.path === activePath && dirty && <span title="Unsaved changes"> •</span>}
      </span>
      <button onClick={handleRename} title="Rename" style={{ fontSize: 11, padding: '1px 4px' }}>
        ✎
      </button>
      <button onClick={handleDelete} title="Delete" style={{ fontSize: 11, padding: '1px 4px', color: 'crimson' }}>
        ×
      </button>
    </div>
  );
}

export default function FileTree({ files, activePath, dirty, onSelect, onUpload, onCreate, onCreateFolder, onRename, onDelete }) {
  const fileInputRef = useRef(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [dragOver, setDragOver] = useState(false);

  const tree = buildTree(files);

  function toggleFolder(path) {
    setCollapsed((prev) => {
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
    const dropped = Array.from(e.dataTransfer.files ?? []);
    for (const file of dropped) await onUpload(file);
  }

  return (
    <div
      onDragOver={(e) => {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 8px', gap: 4 }}>
        <h4 style={{ margin: 0 }}>Files</h4>
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChosen}
          style={{ display: 'none' }}
          accept=".png,.jpg,.jpeg,.pdf,.bib"
        />
      </div>
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
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ) : (
          <FileRow key={node.path} file={node} activePath={activePath} dirty={dirty} depth={0} onSelect={onSelect} onRename={onRename} onDelete={onDelete} />
        )
      )}
    </div>
  );
}
