<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Icon from './Icon.vue';
import { api } from '@/api';
import { state, toast } from '@/stores/app';

const route = useRoute();

interface Msg {
  id: number;
  role: string;
  content: string;
  pending?: boolean;
}

const messages = ref<Msg[]>([]);
const input = ref('');
const sending = ref(false);
const listEl = ref<HTMLElement | null>(null);
const withContext = ref(true);

/** 当前模块 id：模块页 / 实战档案页 */
const moduleId = computed(() => {
  if (route.name === 'module') return (route.params.id as string) || undefined;
  if (route.name === 'works') return 'practice';
  return undefined;
});

const moduleTitle = computed(() => {
  if (!moduleId.value) return '综合讨论';
  const m = state.modules.find((x) => x.id === moduleId.value);
  return m ? m.title : '综合讨论';
});

/** 从全局注入的"当前编辑内容"，由练习页写入 */
const draftContext = computed(() => (window as any).__AI_CONTEXT__ || '');

const QUICK = [
  '帮我看看这段的问题在哪',
  '这个人物立得住吗',
  '这里该怎么埋伏笔',
  '结尾钩子怎么改更勾人',
  '帮我想三个不同的切入点',
];

async function load() {
  const list = await api.chatHistory(moduleId.value);
  messages.value = list.map((m) => ({ ...m }));
  scrollBottom();
}

watch(moduleId, () => load(), { immediate: true });

function scrollBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  });
}

async function send(text?: string) {
  const content = (text ?? input.value).trim();
  if (!content || sending.value) return;
  input.value = '';
  messages.value.push({ id: Date.now(), role: 'user', content, pending: true });
  messages.value.push({ id: Date.now() + 1, role: 'assistant', content: '', pending: true });
  scrollBottom();
  sending.value = true;
  try {
    const reply = await api.chat({
      moduleId: moduleId.value,
      message: content,
      context: withContext.value ? draftContext.value : '',
    });
    const last = messages.value[messages.value.length - 1];
    last.content = reply.content;
    last.pending = false;
    messages.value[messages.value.length - 2].pending = false;
  } catch (e: any) {
    const last = messages.value[messages.value.length - 1];
    last.content = '发送失败：' + (e?.message || '未知错误');
    last.pending = false;
  } finally {
    sending.value = false;
    scrollBottom();
    await load();
  }
}

async function clearChat() {
  if (!confirm('确定清空当前环节的对话记录？')) return;
  await api.clearChat(moduleId.value);
  messages.value = [];
  toast('已清空');
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send();
}
</script>

<template>
  <aside class="ai-panel" :class="{ collapsed: !state.aiOpen }">
    <div class="ai-head">
      <Icon name="sparkle" :size="16" />
      <strong>AI 写作陪练</strong>
      <span class="tag" :class="state.aiEnabled ? 'green' : 'amber'">
        {{ state.aiEnabled ? 'AI' : '本地' }}
      </span>
      <div class="spacer" />
      <button class="icon-btn" title="清空对话" @click="clearChat">
        <Icon name="trash" :size="15" />
      </button>
      <button class="icon-btn" title="收起" @click="state.aiOpen = false">
        <Icon name="close" :size="16" />
      </button>
    </div>

    <div class="ai-context small">
      <Icon name="target" :size="13" />
      <span>当前环节：{{ moduleTitle }}</span>
      <label class="ctx-toggle">
        <input v-model="withContext" type="checkbox" />
        带上我的草稿
      </label>
    </div>

    <div ref="listEl" class="ai-list">
      <div v-if="!messages.length" class="ai-empty">
        <Icon name="chat" :size="26" />
        <p>
          可以问我任何写作问题。<br />
          勾选「带上我的草稿」后，我会连同你正在写的内容一起看。
        </p>
        <div class="quick">
          <button v-for="q in QUICK" :key="q" class="quick-btn" @click="send(q)">
            {{ q }}
          </button>
        </div>
      </div>

      <div
        v-for="m in messages"
        :key="m.id"
        class="bubble-row"
        :class="m.role === 'user' ? 'me' : 'ai'"
      >
        <div class="avatar" :class="m.role">
          <Icon :name="m.role === 'user' ? 'user' : 'sparkle'" :size="13" />
        </div>
        <div class="bubble" :class="{ pending: m.pending }">
          <template v-if="m.pending && !m.content">
            <span class="typing"><i /><i /><i /></span>
          </template>
          <template v-else>{{ m.content }}</template>
        </div>
      </div>
    </div>

    <div class="ai-input">
      <textarea
        v-model="input"
        class="textarea"
        rows="3"
        placeholder="输入问题，Cmd/Ctrl + Enter 发送"
        @keydown="onKey"
      />
      <div class="ai-actions">
        <span class="small muted">
          {{ state.aiEnabled ? `模型 ${state.aiModel}` : '未接模型 · 本地规则回复' }}
        </span>
        <button class="btn primary sm" :disabled="sending || !input.trim()" @click="send()">
          <Icon name="send" :size="14" />
          {{ sending ? '思考中' : '发送' }}
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.ai-panel {
  width: var(--ai-w);
  flex: none;
  background: var(--panel);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition: margin-right 0.22s ease;
}
.ai-panel.collapsed {
  margin-right: calc(-1 * var(--ai-w));
}

.ai-head {
  height: 46px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--accent-deep);
}
.ai-head strong {
  font-size: 13.5px;
  color: var(--ink);
}
.spacer {
  flex: 1;
}
.icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 7px;
  color: var(--ink-dim);
}
.icon-btn:hover {
  background: var(--panel-soft);
  color: var(--accent);
}

.ai-context {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--panel-soft);
  border-bottom: 1px solid var(--line-soft);
  color: var(--ink-mid);
}
.ctx-toggle {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 11.5px;
}
.ctx-toggle input {
  width: 13px;
  height: 13px;
  accent-color: var(--accent);
}

.ai-list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  min-height: 0;
}
.ai-empty {
  text-align: center;
  color: var(--ink-dim);
  padding: 26px 10px;
}
.ai-empty p {
  font-size: 12.5px;
  line-height: 1.9;
  margin: 8px 0 14px;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.quick-btn {
  border: 1px solid var(--line);
  background: var(--panel-soft);
  color: var(--ink-mid);
  border-radius: 16px;
  font-size: 11.5px;
  padding: 5px 10px;
}
.quick-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.bubble-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.bubble-row.me {
  flex-direction: row-reverse;
}
.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-soft);
  border: 1px solid var(--line);
  color: var(--ink-dim);
}
.avatar.user {
  background: var(--ink);
  color: #fff;
  border-color: var(--ink);
}
.avatar.assistant {
  background: var(--accent-soft);
  border-color: #ecd4c8;
  color: var(--accent-deep);
}
.bubble {
  max-width: 84%;
  background: var(--panel-soft);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 9px 12px;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble-row.me .bubble {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.bubble.pending {
  opacity: 0.7;
}
.typing {
  display: inline-flex;
  gap: 3px;
}
.typing i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ink-dim);
  animation: blink 1.2s infinite;
}
.typing i:nth-child(2) {
  animation-delay: 0.2s;
}
.typing i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  0%,
  60%,
  100% {
    opacity: 0.25;
  }
  30% {
    opacity: 1;
  }
}

.ai-input {
  flex: none;
  border-top: 1px solid var(--line-soft);
  padding: 10px 12px 12px;
}
.ai-input .textarea {
  min-height: 66px;
  max-height: 160px;
  font-size: 13.5px;
}
.ai-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

@media (max-width: 960px) {
  .ai-panel {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 35;
    box-shadow: var(--shadow-lg);
  }
}
</style>
