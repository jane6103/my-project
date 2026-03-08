import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Book, Search, Trash2, Save, Menu, X, Download, Edit2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { parseClippings } from './utils/parser';
import { Clipping, BookSummary } from './types';

import { webdavService, WebDAVConfig, SyncStatus } from './services/webdavService';
import { Settings, Cloud, CloudOff, CloudRain, Loader2 } from 'lucide-react';

export default function App() {
  const [clippings, setClippings] = useState<Clipping[]>([]);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedClippingId, setSelectedClippingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // Mobile sidebar toggle
  const [commentDraft, setCommentDraft] = useState('');
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  
  // WebDAV State
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>({
    url: 'https://dav.jianguoyun.com/dav/',
    username: '',
    appPassword: ''
  });

  // Book renaming state
  const [editingBook, setEditingBook] = useState<string | null>(null);
  const [newBookTitle, setNewBookTitle] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load config and data on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem('webdav_config');
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      setWebdavConfig(parsed);
      webdavService.setConfig(parsed);
      loadFromWebDAV();
    } else {
      // Fallback to local API if no WebDAV configured
      loadClippings();
    }
  }, []);

  const loadFromWebDAV = async () => {
    setIsLoading(true);
    setSyncStatus('syncing');
    try {
      const data = await webdavService.loadData();
      // 只要请求成功（即使文件不存在），就说明连接是通的
      setSyncStatus('synced');
      if (data) {
        setClippings(data);
        setError(null);
        setHasUnsyncedChanges(false);
      } else {
        // 文件不存在不代表未连接，只是提醒用户初始化
        setError('云端暂无数据，请上传 txt 文件初始化');
      }
    } catch (err) {
      console.error('WebDAV load failed:', err);
      setSyncStatus('error');
      setError('坚果云连接失败，请检查配置');
    } finally {
      setIsLoading(false);
    }
  };

  const saveToWebDAV = async (data: Clipping[]) => {
    // 只有在配置了账号密码的情况下才尝试同步
    if (!webdavConfig.username || !webdavConfig.appPassword) return;
    
    setSyncStatus('syncing');
    try {
      await webdavService.saveData(data);
      setSyncStatus('synced');
      setHasUnsyncedChanges(false);
    } catch (err) {
      console.error('WebDAV save failed:', err);
      setSyncStatus('error');
    }
  };

  const handleSettingsSave = async () => {
    localStorage.setItem('webdav_config', JSON.stringify(webdavConfig));
    webdavService.setConfig(webdavConfig);
    
    setIsLoading(true);
    const isOk = await webdavService.testConnection();
    if (isOk) {
      alert('连接成功！');
      loadFromWebDAV();
      setIsSettingsOpen(false);
    } else {
      alert('连接失败，请检查账号和应用密码');
      setSyncStatus('error');
      setIsLoading(false);
    }
  };

  const loadClippings = () => {
    setIsLoading(true);
    setError(null);
    fetch('/api/clippings')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch clippings');
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setClippings(data);
        } else {
          throw new Error('Invalid data format received');
        }
      })
      .catch(err => {
        console.error('Failed to load clippings:', err);
        setError('Failed to load data. Please try again.');
      })
      .finally(() => setIsLoading(false));
  };

  // We no longer save to localStorage automatically.
  // Instead, we save specific actions to the API.

  // Update comment draft when selected clipping changes
  useEffect(() => {
    if (selectedClippingId) {
      const clip = clippings.find(c => c.id === selectedClippingId);
      setCommentDraft(clip?.comment || '');
    } else {
      setCommentDraft('');
    }
  }, [selectedClippingId, clippings]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const newClippings = parseClippings(text);
      
      // 1. 获取当前系统中所有划线的“指纹”（位置 + 内容前缀）
      // 注意：指纹不包含书名，这样即使您在应用里改了书名，内容依然能匹配上
      const existingContentSignatures = new Set(
        clippings.map(c => `${c.location}-${c.content.substring(0, 30)}`)
      );
      
      // 2. 将新上传的划线按书名分组
      const newBooksMap = new Map<string, typeof newClippings>();
      newClippings.forEach(c => {
        const list = newBooksMap.get(c.bookTitle) || [];
        list.push(c);
        newBooksMap.set(c.bookTitle, list);
      });

      // 3. 识别哪些书是真正“新”的
      const finalNewClippings: typeof newClippings = [];
      let skippedBooksCount = 0;
      let importedBooksCount = 0;

      newBooksMap.forEach((bookClippings) => {
        // 检查这本书里的划线是否已经在系统中存在（通过指纹匹配）
        // 只要有一条划线匹配上，就认为这本书已经导入过
        const isAlreadyImported = bookClippings.some(c => 
          existingContentSignatures.has(`${c.location}-${c.content.substring(0, 30)}`)
        );

        if (isAlreadyImported) {
          skippedBooksCount++;
        } else {
          finalNewClippings.push(...bookClippings);
          importedBooksCount++;
        }
      });

      if (finalNewClippings.length > 0) {
        // Optimistic update
        const merged = [...finalNewClippings, ...clippings].sort((a, b) => b.timestamp - a.timestamp);
        setClippings(merged);
        setHasUnsyncedChanges(true);

        // Sync to backend (keep as fallback)
        try {
          await fetch('/api/clippings/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalNewClippings)
          });
          
          let message = `成功导入 ${importedBooksCount} 本新书 (${finalNewClippings.length} 条划线)。`;
          if (skippedBooksCount > 0) {
            message += ` 自动跳过了 ${skippedBooksCount} 本已存在的书籍（含已更名书籍），以保护您的修改。`;
          }
          alert(message);
        } catch (err) {
          console.error('Failed to save imported clippings:', err);
        }
      } else {
        if (skippedBooksCount > 0) {
          alert(`未发现新书籍。文档中的 ${skippedBooksCount} 本书已在库中（包含您已更名的书籍），系统已自动跳过。`);
        } else {
          alert('未在文档中发现有效的书摘内容。');
        }
      }
    };
    reader.readAsText(file);
    // Reset input value to allow re-uploading the same file if needed
    event.target.value = '';
  };

  const handleExportExcel = () => {
    if (clippings.length === 0) {
      alert('No clippings to export.');
      return;
    }

    const dataToExport = clippings.map(c => ({
      'Book Title': c.bookTitle,
      'Author': c.author,
      'Content': c.content,
      'My Comment': c.comment,
      'Location': c.location,
      'Date Added': c.dateAdded,
      'Raw Date': c.rawDate
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clippings");
    
    // Generate filename with current date
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `kindle_clippings_${dateStr}.xlsx`);
  };

  // handleSaveComment is now handled by the auto-save effect, but we need to update the API there.

  const handleDeleteClipping = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation(); // Prevent card selection when clicking delete
    if (confirm('Are you sure you want to delete this clipping?')) {
      const updatedClippings = clippings.filter(c => c.id !== id);
      
      // Optimistic update
      setClippings(updatedClippings);
      setHasUnsyncedChanges(true);
      if (selectedClippingId === id) {
        setSelectedClippingId(null);
      }

      // Sync to backend
      try {
        await fetch(`/api/clippings/${id}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to delete clipping on server:', err);
      }
    }
  };

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to delete ALL clippings? This cannot be undone.')) {
      setClippings([]);
      setHasUnsyncedChanges(true);
      setSelectedBook(null);
      setSelectedClippingId(null);

      try {
        await fetch('/api/clippings', { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to clear data on server:', err);
      }
    }
  };

  const startEditingBook = (bookTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBook(bookTitle);
    setNewBookTitle(bookTitle);
  };

  const saveBookTitle = async (oldTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const trimmedNewTitle = newBookTitle.trim();

    if (!trimmedNewTitle || trimmedNewTitle === oldTitle) {
      setEditingBook(null);
      return;
    }

    if (confirm(`Rename "${oldTitle}" to "${trimmedNewTitle}"?`)) {
      const updatedClippings = clippings.map(c => 
        c.bookTitle === oldTitle ? { ...c, bookTitle: trimmedNewTitle } : c
      );
      
      // Optimistic update
      setClippings(updatedClippings);
      setHasUnsyncedChanges(true);
      
      // Update selection if we were viewing this book
      if (selectedBook === oldTitle) {
        setSelectedBook(trimmedNewTitle);
      }
      
      // Sync to backend
      try {
        const res = await fetch('/api/books/rename', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldTitle, newTitle: trimmedNewTitle })
        });

        if (!res.ok) {
          throw new Error('Failed to update book title');
        }
      } catch (err) {
        console.error('Failed to rename book on server:', err);
        alert('Failed to save book title to cloud. Reverting changes...');
        
        // Revert by reloading from server
        fetch('/api/clippings')
          .then(res => res.json())
          .then(data => {
            if (Array.isArray(data)) {
              setClippings(data);
              // Reset selection if needed, or keep it if it still exists
              if (selectedBook === trimmedNewTitle) {
                setSelectedBook(oldTitle); 
              }
            }
          })
          .catch(e => console.error('Failed to reload clippings:', e));
      }
    }
    setEditingBook(null);
  };

  const deleteBook = async (bookTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`确定要删除《${bookTitle}》及其所有划线内容吗？此操作不可撤销。`)) {
      const updatedClippings = clippings.filter(c => c.bookTitle !== bookTitle);
      
      // Optimistic update
      setClippings(updatedClippings);
      setHasUnsyncedChanges(true);
      
      // Clear selection if we were viewing this book
      if (selectedBook === bookTitle) {
        setSelectedBook(null);
      }
      
      // Sync to backend
      try {
        const res = await fetch('/api/books/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookTitle })
        });
        if (!res.ok) throw new Error('Failed to delete on server');
      } catch (err) {
        console.error('Failed to delete book:', err);
        alert('服务器删除失败，但本地已更新。');
      }
    }
  };

  const cancelEditingBook = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBook(null);
  };


  // Derived state: Books list
  const books: BookSummary[] = useMemo(() => {
    const map = new Map<string, { author: string; count: number; lastTimestamp: number }>();
    clippings.forEach(c => {
      const current = map.get(c.bookTitle) || { author: c.author, count: 0, lastTimestamp: 0 };
      map.set(c.bookTitle, { 
        author: c.author, 
        count: current.count + 1,
        lastTimestamp: Math.max(current.lastTimestamp, c.timestamp)
      });
    });
    return Array.from(map.entries()).map(([title, info]) => ({
      title,
      author: info.author,
      count: info.count,
      lastTimestamp: info.lastTimestamp
    })).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }, [clippings]);

  // Derived state: Filtered clippings for the middle column
  const filteredClippings = useMemo(() => {
    let filtered = clippings;
    
    if (selectedBook) {
      filtered = filtered.filter(c => c.bookTitle === selectedBook);
    }

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(c => 
        c.content.toLowerCase().includes(lower) || 
        c.bookTitle.toLowerCase().includes(lower)
      );
    }

    // Sort by timestamp descending (latest first)
    // Note: The main state is already sorted on import, but this ensures 
    // any other mutations keep the sort order if needed.
    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }, [clippings, selectedBook, searchTerm]);

  const activeClipping = useMemo(() => 
    clippings.find(c => c.id === selectedClippingId), 
  [clippings, selectedClippingId]);

  // Auto-save comment with debounce
  useEffect(() => {
    if (!selectedClippingId) return;

    const timer = setTimeout(() => {
      setClippings(prev => {
        let hasChanged = false;
        const updated = prev.map(c => {
          if (c.id === selectedClippingId && c.comment !== commentDraft) {
            hasChanged = true;
            const newClip = { ...c, comment: commentDraft };
            
            // Sync to backend
            fetch(`/api/clippings/${c.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newClip)
            }).catch(err => console.error('Failed to save comment:', err));
            
            return newClip;
          }
          return c;
        });

        if (hasChanged) {
          setHasUnsyncedChanges(true);
        }

        return updated;
      });
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [commentDraft, selectedClippingId]);

  const handleQuoteChange = (newContent: string) => {
    if (!selectedClippingId) return;
    
    setClippings(prev => {
      const updated = prev.map(c => {
        if (c.id === selectedClippingId) {
          const newClip = { ...c, content: newContent };
          
          // Sync to backend
          fetch(`/api/clippings/${c.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newClip)
          }).catch(err => console.error('Failed to save quote edit:', err));
          
          return newClip;
        }
        return c;
      });

      setHasUnsyncedChanges(true);

      return updated;
    });
  };

  return (
    <div className="flex h-screen w-full bg-gray-50 text-gray-900 font-sans overflow-hidden">
      
      {/* Mobile Sidebar Toggle - Only visible on small screens */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 bg-white rounded-md shadow-md border border-gray-200"
        >
          {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Left Sidebar: Navigation & Books */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-72 bg-gray-900 text-gray-300 flex flex-col shadow-xl transition-transform duration-300
        lg:static lg:translate-x-0 lg:shadow-none lg:flex-shrink-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-b border-gray-800 flex-shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white mb-1 flex items-center gap-2">
              <Book className="text-emerald-400" size={24} />
              Kindle Notes
            </h1>
            <p className="text-xs text-gray-500">My Clippings Manager</p>
          </div>
          
          {/* Sync Status Indicator */}
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-800 border border-gray-700">
            {syncStatus === 'synced' && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
            {syncStatus === 'syncing' && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
            {syncStatus === 'disconnected' && <div className="w-2 h-2 rounded-full bg-gray-500" />}
            {syncStatus === 'error' && <div className="w-2 h-2 rounded-full bg-red-500" />}
            <span className="text-[10px] text-gray-400 font-medium">
              {syncStatus === 'synced' && '已同步'}
              {syncStatus === 'syncing' && '同步中'}
              {syncStatus === 'disconnected' && '未连接'}
              {syncStatus === 'error' && '连接错误'}
            </span>
          </div>
        </div>

        <div className="p-4 flex-shrink-0 space-y-2">
          <label className="flex items-center justify-center w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer transition-colors font-medium text-sm gap-2">
            <Upload size={18} />
            <span>Import My Clippings.txt</span>
            <input type="file" className="hidden" accept=".txt" onChange={handleFileUpload} />
          </label>

          <button 
            onClick={handleExportExcel}
            className="flex items-center justify-center w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors text-sm gap-2 border border-gray-700"
          >
            <Download size={16} />
            <span>Export to Excel</span>
          </button>

          <button 
            onClick={() => saveToWebDAV(clippings)}
            disabled={syncStatus === 'syncing'}
            className={`flex items-center justify-center w-full px-4 py-2 rounded-lg transition-all text-sm gap-2 border relative overflow-hidden ${
              hasUnsyncedChanges 
                ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-900/20' 
                : 'bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-700'
            }`}
          >
            {syncStatus === 'syncing' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Cloud size={16} className={hasUnsyncedChanges ? 'animate-bounce' : ''} />
            )}
            <span>{hasUnsyncedChanges ? 'Save & Sync to Cloud' : 'Cloud Synced'}</span>
            {hasUnsyncedChanges && (
              <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full mt-1 mr-1 animate-ping" />
            )}
          </button>
        </div>

          <div className="px-4 pb-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input 
                type="text" 
                placeholder="Search books..." 
                className="w-full bg-gray-800 text-sm text-white pl-9 pr-3 py-2 rounded-md border border-gray-700 focus:outline-none focus:border-emerald-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {error && (
              <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
                <span>{error}</span>
                <button onClick={loadClippings} className="underline hover:text-red-300">Retry</button>
              </div>
            )}
            {isLoading && (
              <div className="mt-2 text-xs text-gray-500 text-center">Loading...</div>
            )}
          </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 scrollbar-thin scrollbar-thumb-gray-700">
          <button
            onClick={() => setSelectedBook(null)}
            className={`w-full text-left px-4 py-2 rounded-md text-sm transition-colors flex justify-between items-center ${
              selectedBook === null 
                ? 'bg-gray-800 text-white font-medium' 
                : 'hover:bg-gray-800/50'
            }`}
          >
            <span>All Clippings</span>
            <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full text-gray-300">{clippings.length}</span>
          </button>

          {books.map((book) => (
            <div
              key={book.title}
              className={`w-full rounded-md text-sm transition-colors group relative ${
                selectedBook === book.title 
                  ? 'bg-gray-800 text-white font-medium' 
                  : 'hover:bg-gray-800/50'
              }`}
            >
              {editingBook === book.title ? (
                <div className="p-2 flex items-center gap-1">
                  <input 
                    type="text" 
                    value={newBookTitle}
                    onChange={(e) => setNewBookTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 text-xs focus:outline-none focus:border-emerald-500"
                    autoFocus
                  />
                  <button onClick={(e) => saveBookTitle(book.title, e)} className="p-1 text-emerald-400 hover:bg-gray-700 rounded">
                    <Check size={14} />
                  </button>
                  <button onClick={(e) => cancelEditingBook(e)} className="p-1 text-red-400 hover:bg-gray-700 rounded">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSelectedBook(book.title)}
                  className="w-full text-left px-4 py-2 flex flex-col"
                >
                  <div className="flex justify-between items-start w-full">
                    <span className="line-clamp-2 pr-6">{book.title}</span>
                    <span className="text-xs bg-gray-800 group-hover:bg-gray-700 px-2 py-0.5 rounded-full text-gray-400 min-w-fit">
                      {book.count}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">{book.author}</div>
                  
                  {/* Edit Button (Visible on Hover) */}
                  <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div 
                      onClick={(e) => startEditingBook(book.title, e)}
                      className="p-1 text-gray-500 hover:text-emerald-400 cursor-pointer"
                      title="Rename Book"
                    >
                      <Edit2 size={12} />
                    </div>
                    <div 
                      onClick={(e) => deleteBook(book.title, e)}
                      className="p-1 text-gray-500 hover:text-red-400 cursor-pointer"
                      title="Delete Book"
                    >
                      <Trash2 size={12} />
                    </div>
                  </div>
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-800 flex-shrink-0 space-y-2">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors w-full justify-center px-4 py-2 hover:bg-gray-800 rounded-md border border-gray-700"
          >
            <Settings size={14} />
            坚果云同步设置
          </button>
          
          <button 
            onClick={handleClearAll}
            className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors w-full justify-center px-4 py-2 hover:bg-red-900/20 rounded-md"
          >
            <Trash2 size={14} />
            Clear All Data
          </button>
        </div>
      </div>

      {/* WebDAV Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
                    <Cloud size={20} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">坚果云 WebDAV 同步</h3>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">WebDAV 地址</label>
                  <input 
                    type="text" 
                    value={webdavConfig.url}
                    onChange={(e) => setWebdavConfig({...webdavConfig, url: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                    placeholder="https://dav.jianguoyun.com/dav/"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">坚果云账号</label>
                  <input 
                    type="text" 
                    value={webdavConfig.username}
                    onChange={(e) => setWebdavConfig({...webdavConfig, username: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                    placeholder="your-email@example.com"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">应用密码</label>
                  <input 
                    type="password" 
                    value={webdavConfig.appPassword}
                    onChange={(e) => setWebdavConfig({...webdavConfig, appPassword: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                    placeholder="请输入独立的应用密码"
                  />
                  <p className="text-[10px] text-gray-400">请在坚果云官网：账户信息 -&gt; 安全选项 -&gt; 第三方应用管理中生成</p>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    onClick={handleSettingsSave}
                    disabled={isLoading}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={18} />}
                    保存并测试连接
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Middle Column: List */}
      <div className="flex-1 lg:flex-none lg:w-96 flex flex-col min-w-0 border-r border-gray-200 bg-white">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div>
            <h2 className="font-semibold text-gray-800 truncate max-w-[200px] sm:max-w-xs">
              {selectedBook || 'All Clippings'}
            </h2>
            <p className="text-xs text-gray-500">
              {filteredClippings.length} items
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-gray-50/50">
          {filteredClippings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-sm">
              <Book size={48} className="mb-4 opacity-20" />
              <p>No clippings found.</p>
            </div>
          ) : (
            filteredClippings.map((clip) => (
              <motion.div
                key={clip.id}
                layoutId={`card-${clip.id}`}
                onClick={() => setSelectedClippingId(clip.id)}
                className={`group relative p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md ${
                  selectedClippingId === clip.id
                    ? 'bg-white border-emerald-500 shadow-sm ring-1 ring-emerald-500/20'
                    : 'bg-white border-gray-200 hover:border-emerald-300'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider line-clamp-1 pr-6">
                    {clip.bookTitle}
                  </h3>
                  
                  {/* Delete Button on Card */}
                  <button
                    onClick={(e) => handleDeleteClipping(clip.id, e)}
                    className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete Clipping"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-sm text-gray-800 line-clamp-3 mb-3 font-serif leading-relaxed">
                  {clip.content}
                </p>
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span>{clip.dateAdded.split(' ').slice(0, 3).join(' ')}</span>
                  {clip.comment && (
                    <span className="flex items-center gap-1 text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded">
                      <Save size={10} /> Note
                    </span>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Right Column: Detail */}
      <div className={`
        fixed inset-0 z-50 bg-white transition-transform duration-300
        lg:static lg:flex-1 lg:flex lg:flex-col lg:bg-gray-50 lg:translate-x-0
        ${selectedClippingId ? 'translate-x-0' : 'translate-x-full'}
      `}>
        {activeClipping ? (
          <div className="h-full flex flex-col overflow-hidden">
            {/* Mobile Header for Detail View */}
            <div className="lg:hidden p-4 border-b border-gray-100 flex items-center gap-2 bg-white">
              <button onClick={() => setSelectedClippingId(null)} className="p-2 -ml-2 hover:bg-gray-100 rounded-full">
                <X size={20} />
              </button>
              <span className="font-medium">Detail View</span>
            </div>

            <div className="flex-1 overflow-y-auto p-6 lg:p-10">
              <div className="max-w-3xl mx-auto space-y-8">
                
                {/* Book Info Header */}
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-serif font-bold text-gray-900">{activeClipping.bookTitle}</h2>
                  <p className="text-gray-500 text-sm">{activeClipping.author}</p>
                </div>

                {/* Quote Card */}
                <div className="relative bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
                  <div className="absolute top-6 left-6 text-6xl text-gray-100 font-serif leading-none select-none">“</div>
                  
                  <textarea
                    value={activeClipping.content}
                    onChange={(e) => handleQuoteChange(e.target.value)}
                    className="relative z-10 w-full bg-transparent border-none focus:ring-0 p-0 text-base md:text-lg font-serif text-gray-800 leading-loose text-justify resize-none overflow-hidden"
                    style={{ 
                      minHeight: '150px', 
                      height: 'auto',
                      textAlignLast: 'left'
                    }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = el.scrollHeight + 'px';
                      }
                    }}
                  />

                  <div className="absolute bottom-6 right-6 text-6xl text-gray-100 font-serif leading-none select-none rotate-180">“</div>
                  
                  <div className="mt-8 pt-6 border-t border-gray-100 flex justify-center text-xs text-gray-400 uppercase tracking-widest">
                    {activeClipping.location}
                  </div>
                </div>

                {/* Comment Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm font-medium text-gray-700">
                    <div className="flex items-center gap-2">
                      <Save size={16} />
                      <span>Your Thoughts</span>
                    </div>
                    <span className="text-xs text-gray-400 font-normal">Auto-saving...</span>
                  </div>
                  <textarea
                    className="w-full h-40 p-4 rounded-xl border border-gray-200 bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none shadow-sm text-gray-700 leading-relaxed"
                    placeholder="Write your reflections here..."
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                  />
                  <div className="flex justify-end gap-3">
                    <button 
                      onClick={() => handleDeleteClipping(activeClipping.id)}
                      className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      Delete Note
                    </button>
                    <div className="flex items-center gap-2 text-emerald-600 text-xs opacity-50">
                      <Check size={12} /> Saved
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8 text-center">
            <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-6">
              <Book size={40} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-600 mb-2">Select a clipping to view details</h3>
            <p className="max-w-xs text-sm">
              Choose a highlight from the list to see the full text and add your own notes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
