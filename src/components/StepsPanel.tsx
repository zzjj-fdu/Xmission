import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import {
  addStep,
  completeStep,
  deleteStep,
  listSteps,
  onStepsChanged,
  reopenStep,
} from '../api/steps';
import type { Step } from '../api/steps';
import { activeTheme as pixelJrpg } from '../themes';
import { PixelIcon } from './PixelIcon';
import { QuestCheckbox } from './QuestCheckbox';
import { PixelInput } from './PixelInput';

const { colors, font } = pixelJrpg;

interface StepNode {
  step: Step;
  children: StepNode[];
}

/** 平铺步骤列表（已按 orderIndex 排序）→ 按 parentStepId 建树 */
function buildTree(steps: Step[]): StepNode[] {
  const nodes = new Map<string, StepNode>();
  steps.forEach((s) => nodes.set(s.id, { step: s, children: [] }));
  const roots: StepNode[] = [];
  nodes.forEach((node) => {
    const pid = node.step.parentStepId;
    const parent = pid ? nodes.get(pid) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

/** 步骤行内的小号文字按钮（复用像素描边风格，比 JrpgButton 紧凑） */
function StepActionButton({
  children,
  onClick,
  danger,
  title,
}: {
  children: string;
  onClick: () => void;
  danger?: boolean;
  title?: string;
}) {
  const [hover, setHover] = useState(false);
  const style: CSSProperties = {
    background: 'transparent',
    border: `1px solid ${danger ? colors.danger : colors.goldDark}`,
    color: danger ? colors.danger : hover ? colors.accent : colors.textMuted,
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 1,
    padding: '3px 6px',
    cursor: 'pointer',
    flexShrink: 0,
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={style}
    >
      {children}
    </button>
  );
}

/**
 * 任务步骤树面板：缩进树（20px/级 + 左侧 1px 深金竖线）+ QuestCheckbox
 * + 删除（级联）+ ＋子步骤 + 根级添加输入框；订阅 steps-changed 即时刷新。
 */
export function StepsPanel({ taskId }: { taskId: string }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [rootTitle, setRootTitle] = useState('');
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [childTitle, setChildTitle] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await listSteps(taskId);
      setSteps(list);
    } catch (err) {
      console.error('[steps] 拉取步骤列表失败', err);
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | null = null;
    onStepsChanged(() => {
      void refresh();
    })
      .then((u) => {
        unlisten = u;
      })
      .catch((err: unknown) => {
        console.error('[steps] 订阅 steps-changed 事件失败', err);
      });
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  const tree = useMemo(() => buildTree(steps), [steps]);

  const handleToggle = (step: Step) => {
    const action = step.status === 'done' ? reopenStep : completeStep;
    action(step.id).catch((err: unknown) => {
      console.error('[steps] 切换步骤完成状态失败', err);
    });
  };

  const handleDelete = (step: Step) => {
    if (!window.confirm(`确定删除步骤「${step.title}」吗？其子步骤会一并删除。`)) return;
    deleteStep(step.id).catch((err: unknown) => {
      console.error('[steps] 删除步骤失败', err);
    });
  };

  const submitAdd = (parentStepId: string | null, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    addStep(taskId, trimmed, parentStepId)
      .then(() => {
        if (parentStepId) {
          setChildTitle('');
          setAddingUnder(null);
        } else {
          setRootTitle('');
        }
      })
      .catch((err: unknown) => {
        console.error('[steps] 添加步骤失败', err);
      });
  };

  const addInputRow = (depth: number, parentStepId: string | null) => (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        paddingLeft: depth * 20 + 4,
        borderLeft: depth > 0 ? `1px solid ${colors.goldDark}` : 'none',
        marginLeft: depth > 0 ? 12 : 0,
        marginTop: 4,
      }}
    >
      <PixelInput
        autoFocus
        value={parentStepId ? childTitle : rootTitle}
        placeholder={parentStepId ? '子步骤标题，回车添加' : '添加步骤…'}
        onChange={(e) =>
          parentStepId ? setChildTitle(e.target.value) : setRootTitle(e.target.value)
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitAdd(parentStepId, parentStepId ? childTitle : rootTitle);
          }
          if (e.key === 'Escape' && parentStepId) {
            setAddingUnder(null);
            setChildTitle('');
          }
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
      {parentStepId && (
        <StepActionButton onClick={() => submitAdd(parentStepId, childTitle)}>
          添加
        </StepActionButton>
      )}
    </div>
  );

  const renderNode = (node: StepNode, depth: number): ReactElement => {
    const { step } = node;
    const done = step.status === 'done';
    return (
      <div key={step.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 0 4px 4px',
            paddingLeft: depth * 20 + 4,
            marginLeft: depth > 0 ? 12 : 0,
            borderLeft: depth > 0 ? `1px solid ${colors.goldDark}` : 'none',
          }}
        >
          <QuestCheckbox checked={done} onToggle={() => handleToggle(step)} />
          <span
            title={step.title}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              fontFamily: font.body,
              color: done ? colors.textMuted : colors.text,
              textDecoration: done ? 'line-through' : 'none',
              opacity: done ? 0.7 : 1,
            }}
          >
            {step.title}
          </span>
          {step.estimatedMin != null && (
            <span style={{ color: colors.textMuted, fontSize: 12, flexShrink: 0 }}>
              {step.estimatedMin}min
            </span>
          )}
          <StepActionButton
            title="添加子步骤"
            onClick={() => {
              setAddingUnder((cur) => (cur === step.id ? null : step.id));
              setChildTitle('');
            }}
          >
            ＋子步骤
          </StepActionButton>
          <StepActionButton danger title="删除（含子步骤）" onClick={() => handleDelete(step)}>
            删除
          </StepActionButton>
        </div>
        {addingUnder === step.id && addInputRow(depth + 1, step.id)}
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div
      style={{
        border: `1px solid ${colors.goldDark}`,
        backgroundColor: colors.xpTrack,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: colors.textMuted,
          fontSize: 12,
          fontFamily: font.display,
          marginBottom: 4,
        }}
      >
        <PixelIcon name="scroll" size={12} />
        步骤（{steps.filter((s) => s.status === 'done').length}/{steps.length}）
      </div>
      {tree.map((node) => renderNode(node, 0))}
      {addInputRow(0, null)}
    </div>
  );
}
