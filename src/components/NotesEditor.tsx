import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { safeNotesHtml } from '../utils/safeNotes';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontSize } from './tiptapFontSize';
import { activeTheme as pixelJrpg } from '../themes';

const t = pixelJrpg;

const FONT_SIZES = ['12px', '14px', '16px', '20px', '24px'] as const;

/** 工具栏按钮：等宽像素字，激活时金底深字 */
function ToolButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault() /* 保持编辑器选区不丢失 */}
      onClick={onClick}
      style={{
        minWidth: 26,
        height: 24,
        padding: '0 6px',
        border: `1px solid ${active ? t.colors.accent : t.colors.goldDark}`,
        backgroundColor: active ? t.colors.accent : t.colors.xpTrack,
        color: active ? t.colors.xpTrack : t.colors.text,
        fontFamily: t.font.display,
        fontSize: 12,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const currentSize = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? '';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        padding: '4px 6px',
        borderBottom: `1px solid ${t.colors.goldDark}`,
        backgroundColor: t.colors.panelLight,
      }}
    >
      <ToolButton
        label="B"
        title="加粗"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        label="I"
        title="斜体"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        label="S"
        title="删除线"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <select
        title="字号"
        value={currentSize}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontSize(v).run();
          else editor.chain().focus().unsetFontSize().run();
        }}
        style={{
          height: 24,
          border: `1px solid ${t.colors.goldDark}`,
          backgroundColor: t.colors.xpTrack,
          color: t.colors.text,
          fontFamily: t.font.display,
          fontSize: 12,
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <option value="">字号</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s.replace('px', '')}
          </option>
        ))}
      </select>
      <ToolButton
        label="•≡"
        title="无序列表"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        label="1≡"
        title="有序列表"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
    </div>
  );
}

export interface NotesEditorProps {
  /** 已有备注 HTML（可能为 null） */
  initialHTML: string | null;
  /** 空备注回调 null，避免存一堆 <p></p> */
  onSave: (html: string | null) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * 任务备注富文本编辑器（TipTap，华为便签式常见功能）：
 * 加粗 / 斜体 / 删除线 / 字号 / 无序·有序列表。内容以 HTML 存进 tasks.notes。
 */
export function NotesEditor({ initialHTML, onSave, onCancel }: NotesEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, TextStyle, FontSize],
    content: safeNotesHtml(initialHTML),
    editorProps: {
      attributes: {
        class: 'notes-editor-content',
        'aria-label': '任务备注',
      },
    },
  });

  // 切换编辑的任务时重置内容
  useEffect(() => {
    if (editor && (initialHTML ?? '') !== editor.getHTML()) {
      editor.commands.setContent(safeNotesHtml(initialHTML));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHTML]);

  if (!editor) return null;

  const handleSave = () => {
    const html = editor.getHTML();
    // 空内容存 null，避免一堆 <p></p>
    void onSave(editor.isEmpty ? null : html);
  };

  return (
    <div
      style={{
        border: `2px solid ${t.colors.goldDark}`,
        backgroundColor: t.colors.xpTrack,
        marginTop: 6,
      }}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '6px 8px',
          borderTop: `1px solid ${t.colors.goldDark}`,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            border: `1px solid ${t.colors.goldDark}`,
            background: 'transparent',
            color: t.colors.textMuted,
            fontFamily: t.font.display,
            fontSize: 12,
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{
            border: `1px solid ${t.colors.goldDark}`,
            backgroundColor: t.colors.accent,
            color: t.colors.xpTrack,
            fontFamily: t.font.display,
            fontSize: 12,
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          保存备注
        </button>
      </div>
    </div>
  );
}
