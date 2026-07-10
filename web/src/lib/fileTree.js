// Converts the manifest's flat file list into a nested folder tree.
// Folders are implied by path segments, plus any explicit empty-folder
// markers (type: 'folder') created via the "+ Folder" button.
export function buildTree(files) {
  const root = { name: '', path: '', type: 'folder', children: [] };

  function getOrCreateFolder(parent, name, path) {
    let node = parent.children.find((c) => c.type === 'folder' && c.name === name);
    if (!node) {
      node = { name, path, type: 'folder', children: [] };
      parent.children.push(node);
    }
    return node;
  }

  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/');
      node = getOrCreateFolder(node, parts[i], folderPath);
    }
    const name = parts[parts.length - 1];
    if (file.type === 'folder') {
      getOrCreateFolder(node, name, file.path);
    } else {
      node.children.push({ ...file, name, type: file.type });
    }
  }

  function sortTree(node) {
    node.children.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach((c) => c.type === 'folder' && sortTree(c));
  }
  sortTree(root);

  return root.children;
}
