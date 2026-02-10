/**
 * 偏好编辑对话框组件
 * 支持编辑、添加、删除用户偏好设置
 */
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PreferenceItem } from "@/lib/api";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

interface PreferenceEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: PreferenceItem[];
  onSave: (preferences: PreferenceItem[]) => void;
}

const CATEGORIES = ['音乐', '空调', '座椅', '导航', '饮食', '其他'];

export function PreferenceEditDialog({
  open,
  onOpenChange,
  preferences,
  onSave,
}: PreferenceEditDialogProps) {
  const [editedPrefs, setEditedPrefs] = useState<PreferenceItem[]>(preferences);
  const [newPref, setNewPref] = useState<Partial<PreferenceItem>>({
    category: '音乐',
    key: '',
    value: '',
  });

  const handleUpdate = (id: string, field: keyof PreferenceItem, value: string) => {
    setEditedPrefs(prev =>
      prev.map(p => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const handleDelete = (id: string) => {
    setEditedPrefs(prev => prev.filter(p => p.id !== id));
    toast.success('已删除偏好设置');
  };

  const handleAdd = () => {
    if (!newPref.key || !newPref.value) {
      toast.error('请填写完整的偏好信息');
      return;
    }
    const newItem: PreferenceItem = {
      id: `pref_${Date.now()}`,
      category: newPref.category || '其他',
      key: newPref.key,
      value: newPref.value,
      context: newPref.context,
    };
    setEditedPrefs(prev => [...prev, newItem]);
    setNewPref({ category: '音乐', key: '', value: '' });
    toast.success('已添加新偏好');
  };

  const handleSave = () => {
    onSave(editedPrefs);
    onOpenChange(false);
    toast.success('偏好设置已保存');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑偏好设置</DialogTitle>
          <DialogDescription>
            修改、添加或删除用户的偏好设置，支持多种分类
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 现有偏好列表 */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">现有偏好</h4>
            {editedPrefs.map(pref => (
              <div key={pref.id} className="grid grid-cols-12 gap-2 items-start p-3 border rounded-lg bg-muted/30">
                <div className="col-span-3">
                  <Label className="text-xs">分类</Label>
                  <Select
                    value={pref.category}
                    onValueChange={v => handleUpdate(pref.id, 'category', v)}
                  >
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">偏好项</Label>
                  <Input
                    value={pref.key}
                    onChange={e => handleUpdate(pref.id, 'key', e.target.value)}
                    className="h-8 text-xs mt-1"
                    placeholder="如：喜欢的歌手"
                  />
                </div>
                <div className="col-span-4">
                  <Label className="text-xs">偏好值</Label>
                  <Input
                    value={pref.value}
                    onChange={e => handleUpdate(pref.id, 'value', e.target.value)}
                    className="h-8 text-xs mt-1"
                    placeholder="如：周杰伦"
                  />
                </div>
                <div className="col-span-2 flex items-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(pref.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* 添加新偏好 */}
          <div className="space-y-3 pt-4 border-t">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Plus className="h-4 w-4" />
              添加新偏好
            </h4>
            <div className="grid grid-cols-12 gap-2 items-end p-3 border rounded-lg bg-primary/5">
              <div className="col-span-3">
                <Label className="text-xs">分类</Label>
                <Select
                  value={newPref.category}
                  onValueChange={v => setNewPref(prev => ({ ...prev, category: v }))}
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Label className="text-xs">偏好项</Label>
                <Input
                  value={newPref.key || ''}
                  onChange={e => setNewPref(prev => ({ ...prev, key: e.target.value }))}
                  className="h-8 text-xs mt-1"
                  placeholder="如：喜欢的歌手"
                />
              </div>
              <div className="col-span-4">
                <Label className="text-xs">偏好值</Label>
                <Input
                  value={newPref.value || ''}
                  onChange={e => setNewPref(prev => ({ ...prev, value: e.target.value }))}
                  className="h-8 text-xs mt-1"
                  placeholder="如：周杰伦"
                />
              </div>
              <div className="col-span-2">
                <Button
                  size="sm"
                  className="h-8 w-full"
                  onClick={handleAdd}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  添加
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>
            保存更改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
