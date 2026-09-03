<script setup lang="ts">
import { ref, watch } from 'vue';
import Icon from './Icon.vue';
import { api } from '@/api';
import { state, refreshAll, toast } from '@/stores/app';

const open = ref(false);
const saving = ref(false);
const showKey = ref(false);
const form = ref({ baseUrl: '', model: '', apiKey: '' });

async function load() {
  const s = await api.aiSettings();
  form.value.baseUrl = s.baseUrl || '';
  form.value.model = s.model || '';
  form.value.apiKey = '';
}

watch(open, (v) => {
  if (v) load();
});

async function save() {
  saving.value = true;
  try {
    const payload: any = { baseUrl: form.value.baseUrl, model: form.value.model };
    if (form.value.apiKey) payload.apiKey = form.value.apiKey;
    await api.saveAiSettings(payload);
    await refreshAll();
    toast(state.aiEnabled ? '已接入大模型，分析将由 AI 完成' : '已保存');
    open.value = false;
  } catch {
    toast('保存失败');
  } finally {
    saving.value = false;
  }
}

async function clearKey() {
  if (!confirm('确定移除已配置的密钥吗？移除后将回到本地诊断模式。')) return;
  await api.saveAiSettings({ apiKey: '' });
  await refreshAll();
  toast('已回到本地诊断模式');
  open.value = false;
}
</script>

<template>
  <div>
    <button class="icon-btn" title="AI 设置" @click="open = true">
      <Icon name="settings" :size="18" />
    </button>

    <div v-if="open" class="mask" @click.self="open = false">
      <div class="dialog card">
        <div class="card-head">
          <h3>AI 分析设置</h3>
          <div class="spacer" />
          <button class="icon-btn" @click="open = false">
            <Icon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body">
          <p class="small muted intro">
            留空即为「本地诊断模式」：不联网、不花钱，用内置规则做量化体检（字数、句长、对话占比、套话、感官词、因果连接词）。
            填入接口后可让大模型读你的稿子，给出逐段批改和改写示范。
          </p>

          <div class="field">
            <label>接口地址（OpenAI 兼容）</label>
            <input
              v-model="form.baseUrl"
              class="input"
              placeholder="https://api.openai.com/v1"
            />
            <p class="small muted hint">支持任意 OpenAI 兼容接口，含各类中转与本地部署。</p>
          </div>

          <div class="field">
            <label>模型名称</label>
            <input v-model="form.model" class="input" placeholder="gpt-4o-mini" />
          </div>

          <div class="field">
            <label>API Key</label>
            <div class="key-row">
              <input
                v-model="form.apiKey"
                class="input"
                :type="showKey ? 'text' : 'password'"
                placeholder="留空表示不修改；填入后即启用 AI 分析"
              />
              <button class="btn sm" @click="showKey = !showKey">
                {{ showKey ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>

          <div class="tips">
            <strong>提示</strong>
            <ul>
              <li>配置保存在本机 sqlite 数据库中，不会上传。</li>
              <li>AI 调用失败时自动降级为本地诊断，不会中断使用。</li>
              <li>密钥仅本机使用、未做加密，公共电脑上请勿保存。</li>
            </ul>
          </div>
        </div>

        <div class="dialog-foot">
          <button class="btn danger" @click="clearKey">移除密钥</button>
          <div class="spacer" />
          <button class="btn" @click="open = false">取消</button>
          <button class="btn primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.icon-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 9px;
  color: var(--ink-mid);
}
.icon-btn:hover {
  background: var(--panel-soft);
  border-color: var(--line);
  color: var(--accent);
}
.spacer {
  flex: 1;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(43, 42, 38, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}
.dialog {
  width: 100%;
  max-width: 520px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
}
.card-body {
  overflow-y: auto;
}
.intro {
  margin-bottom: 14px;
}
.hint {
  margin-top: 4px;
}
.key-row {
  display: flex;
  gap: 8px;
}
.dialog-foot {
  display: flex;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--line-soft);
}
.tips {
  background: var(--panel-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-size: 12.5px;
  color: var(--ink-mid);
}
.tips strong {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
}
.tips ul {
  padding-left: 18px;
  line-height: 1.9;
}
</style>
