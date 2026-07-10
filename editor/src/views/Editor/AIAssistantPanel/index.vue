<template>
  <div class="ai-assistant-panel">
    <div class="panel-header">
      <span class="title">AI Assistant</span>
      <span class="close-btn" @click="close()"><i-icon-park-outline:close /></span>
    </div>

    <div class="chat-log" ref="chatLogRef">
      <div class="message assistant" v-if="!submittedKeyword">
        <div class="bubble welcome">
          Enter a topic below to generate a new presentation, or pick one of these:
        </div>
        <div class="recommends">
          <div class="recommend" v-for="(item, index) in recommends" :key="index" @click="submitTopic(item)">{{ item }}</div>
        </div>
      </div>

      <div class="message user" v-if="submittedKeyword">
        <div class="bubble">{{ submittedKeyword }}</div>
      </div>

      <div class="message assistant" v-if="submittedKeyword && (step === 'outline' || step === 'template')">
        <div class="bubble outline-bubble">
          <pre ref="outlineRef" v-if="outlineCreating">{{ outline }}</pre>
          <div class="outline-view" v-else-if="step === 'outline'">
            <OutlineEditor v-model:value="outline" />
          </div>
          <div class="outline-done" v-else>Outline confirmed — template selected below.</div>

          <div class="btns" v-if="step === 'outline' && !outlineCreating">
            <Button class="btn" type="primary" @click="step = 'template'">Choose Template</Button>
            <Button class="btn" @click="regenerate()">Regenerate</Button>
          </div>
        </div>
      </div>

      <div class="message assistant" v-if="submittedKeyword && step === 'setup'">
        <div class="bubble error-bubble">
          Sorry, something went wrong generating the outline. Please try again.
        </div>
      </div>

      <div class="message assistant" v-if="step === 'template'">
        <div class="bubble template-bubble">
          <div class="templates">
            <div class="template"
              :class="{ 'selected': selectedTemplate === template.id }"
              v-for="template in templates"
              :key="template.id"
              @click="selectedTemplate = template.id"
            >
              <img :src="template.cover" :alt="template.name">
            </div>
          </div>
          <div class="btns">
            <Button class="btn" type="primary" @click="createPPT()">Generate</Button>
            <Button class="btn" @click="step = 'outline'">Back to Outline</Button>
          </div>
        </div>
      </div>
    </div>

    <div class="quick-settings" v-if="!submittedKeyword">
      <div class="config-item">
        <div class="label">Language:</div>
        <Select
          class="config-content"
          style="width: 80px;"
          v-model:value="language"
          :options="[
            { label: 'English', value: 'English' },
            { label: 'Indonesian', value: 'Indonesian' },
            { label: 'Chinese', value: 'Chinese' },
            { label: 'Japanese', value: 'Japanese' },
          ]"
        />
      </div>
      <div class="config-item">
        <div class="label">Style:</div>
        <Select
          class="config-content"
          style="width: 80px;"
          v-model:value="style"
          :options="[
            { label: 'General', value: 'General' },
            { label: 'Academic', value: 'Academic' },
            { label: 'Professional', value: 'Professional' },
            { label: 'Educational', value: 'Educational' },
            { label: 'Marketing', value: 'Marketing' },
          ]"
        />
      </div>
      <div class="config-item">
        <Checkbox v-model:value="overwrite" v-if="!isEmptySlide">Overwrite existing slides</Checkbox>
      </div>
    </div>

    <div class="chat-input">
      <Input class="input"
        ref="inputRef"
        v-model:value="keyword"
        :maxlength="50"
        placeholder="Ask Anything..."
        @enter="submitTopic()"
      >
        <template #suffix>
          <span class="count">{{ keyword.length }} / 50</span>
          <div class="submit" @click="submitTopic()"><i-icon-park-outline:send class="icon" /></div>
        </template>
      </Input>
    </div>

    <FullscreenSpin :loading="loading" tip="AI is generating, please wait patiently ..." />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { jsonrepair } from 'jsonrepair'
import api from '@/services'
import useAIPPT from '@/hooks/useAIPPT'
import useSlideHandler from '@/hooks/useSlideHandler'
import type { AIPPTSlide } from '@/types/AIPPT'
import type { Slide, SlideTheme } from '@/types/slides'
import message from '@/utils/message'
import { decrypt } from '@/utils/crypto'
import { useMainStore, useSlidesStore } from '@/store'
import Input from '@/components/Input.vue'
import Button from '@/components/Button.vue'
import Select from '@/components/Select.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'
import OutlineEditor from '@/components/OutlineEditor.vue'
import Checkbox from '@/components/Checkbox.vue'

const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const { templates } = storeToRefs(slidesStore)

const { resetSlides, isEmptySlide } = useSlideHandler()
const { AIPPT, presetImgPool, getMdContent } = useAIPPT()

const language = ref('English')
const style = ref('General')
const img = ref('')
const keyword = ref('')
const submittedKeyword = ref('')
const outline = ref('')
const selectedTemplate = ref('template_1')
const loading = ref(false)
const outlineCreating = ref(false)
const overwrite = ref(true)
const step = ref<'setup' | 'outline' | 'template'>('setup')
const model = ref('deepseek-v4-flash')
const outlineRef = useTemplateRef<HTMLElement>('outlineRef')
const inputRef = useTemplateRef<InstanceType<typeof Input>>('inputRef')
const chatLogRef = useTemplateRef<HTMLElement>('chatLogRef')

// Auto-trigger from dashboard: if a prompt was passed via URL params,
// pre-fill keyword + language and auto-generate outline.
const urlParams = new URLSearchParams(window.location.search)
const autoPrompt = urlParams.get('prompt')
const autoLang = urlParams.get('lang')
if (autoPrompt) {
  keyword.value = autoPrompt
}
if (autoLang) {
  const langMap: Record<string, string> = {
    'Bahasa Indonesia': 'Indonesian',
    'English': 'English',
    '中文': 'Chinese',
    'Español': 'English', // fallback
    '日本語': 'Japanese',
  }
  language.value = langMap[autoLang] || 'English'
}

// Strip prompt/lang from URL so a page refresh doesn't re-trigger (avoids
// a paid LLM call on every reload)
if (autoPrompt || autoLang) {
  urlParams.delete('prompt')
  urlParams.delete('lang')
  const remaining = urlParams.toString()
  const newUrl = remaining
    ? `${window.location.pathname}?${remaining}`
    : window.location.pathname
  window.history.replaceState(null, '', newUrl)
}

const shouldAutoGenerate = !!autoPrompt

const recommends = ref([
  '2025 Technology Frontier Trends',
  'How Big Data is Changing the World',
  'Catering Market Research and Study',
  'Applications of AIGC in Education',
  'Social Media and Brand Marketing',
  'How 5G Technology Changes Our Lives',
  'Annual Work Summary and Outlook',
  'Blockchain Technology and Its Applications',
  'College Student Career Planning',
  'Company Annual Meeting Plan',
])

onMounted(() => {
  setTimeout(() => {
    inputRef.value?.focus()
  }, 500)

  if (shouldAutoGenerate) {
    setTimeout(() => {
      submitTopic()
    }, 800)
  }
})

const close = () => mainStore.setAIPPTDialogState(false)

const submitTopic = (value?: string) => {
  if (value) keyword.value = value
  if (!keyword.value) return message.error('Please enter a PPT topic first')
  submittedKeyword.value = keyword.value
  createOutline()
}

const regenerate = () => {
  outline.value = ''
  submittedKeyword.value = ''
  keyword.value = ''
  step.value = 'setup'
  setTimeout(() => inputRef.value?.focus(), 100)
}

const createOutline = async () => {
  loading.value = true
  outlineCreating.value = true

  const stream = await api.AIPPT_Outline({
    content: keyword.value,
    language: language.value,
    model: model.value,
  })
  if (typeof stream === 'object' && stream.state === -1) {
    loading.value = false
    outlineCreating.value = false
    return message.error('The concurrency for this model API is too high, please try another model')
  }

  loading.value = false
  step.value = 'outline'

  const reader: ReadableStreamDefaultReader = stream.body.getReader()
  const decoder = new TextDecoder('utf-8')

  const readStream = () => {
    reader.read().then(({ done, value }) => {
      if (done) {
        outline.value = getMdContent(outline.value)
        outline.value = outline.value.replace(/<!--[\s\S]*?-->/g, '')
        outlineCreating.value = false
        return
      }

      const chunk = decoder.decode(value, { stream: true })
      outline.value += chunk

      if (outlineRef.value) {
        outlineRef.value.scrollTop = outlineRef.value.scrollHeight + 20
      }
      if (chatLogRef.value) {
        chatLogRef.value.scrollTop = chatLogRef.value.scrollHeight
      }

      readStream()
    })
  }
  readStream()
}

const createPPT = async (template?: { slides: Slide[], theme: SlideTheme }) => {
  loading.value = true
  mainStore.setAIPPTDialogState('running')
  message.loading('Presentation is being generated, please wait ...', { duration: 0 })

  if (overwrite.value) resetSlides()

  const stream = await api.AIPPT({
    content: outline.value,
    language: language.value,
    style: style.value,
    model: model.value,
  })
  if (typeof stream === 'object' && stream.state === -1) {
    loading.value = false
    message.closeAll()
    mainStore.setAIPPTDialogState(true)
    return message.error('The concurrency for this model API is too high, please try another model')
  }

  if (img.value === 'test') {
    const imgs = await api.getMockData('imgs')
    presetImgPool(imgs)
  }

  let templateData = template
  if (!templateData) templateData = await api.getMockData(selectedTemplate.value)
  const templateSlides: Slide[] = templateData!.slides
  const templateTheme: SlideTheme = templateData!.theme

  const reader: ReadableStreamDefaultReader = stream.body.getReader()
  const decoder = new TextDecoder('utf-8')

  // Buffer partial lines across network chunk boundaries
  let buf = ''

  const readStream = () => {
    reader.read().then(({ done, value }) => {
      if (done) {
        if (buf.trim()) processChunk(buf)
        buf = ''
        loading.value = false
        message.closeAll()
        mainStore.setAIPPTDialogState(false)
        slidesStore.setTheme(templateTheme)
        return
      }

      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) processChunk(line)
      }

      readStream()
    })
  }

  const processChunk = (chunk: string) => {
    try {
      const text = chunk.replace('```jsonl', '').replace('```json', '').replace('```', '').trim()
      if (text) {
        const slide: AIPPTSlide = JSON.parse(jsonrepair(text))
        AIPPT(templateSlides, [slide])
      }
    }
    catch (err) {
      // eslint-disable-next-line
      console.error(err)
    }
  }
  readStream()
}

const uploadLocalTemplate = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.pptist'
  input.click()
  input.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.addEventListener('load', () => {
        try {
          const { slides, theme } = JSON.parse(decrypt(reader.result as string))
          createPPT({ slides, theme })
        }
        catch {
          message.error('The uploaded template file data is invalid, please re-upload or use a preset template')
        }
      })
      reader.readAsText(file)
    }
  })
}

defineExpose({ uploadLocalTemplate })
</script>

<style lang="scss" scoped>
.ai-assistant-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.panel-header {
  height: 40px;
  flex-shrink: 0;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid $borderColor;

  .title {
    font-weight: 700;
    font-size: 14px;
    background: linear-gradient(270deg, #d897fd, #33bcfc);
    background-clip: text;
    color: transparent;
  }
  .close-btn {
    cursor: pointer;
    display: flex;
    align-items: center;
    color: #9a9bb5;

    &:hover {
      color: $textColor;
    }
  }
}
.chat-log {
  flex: 1;
  overflow: auto;
  padding: 12px;
}
.message {
  margin-bottom: 12px;
  display: flex;

  &.user {
    justify-content: flex-end;

    .bubble {
      background-color: $themeColor;
      color: #fff;
    }
  }
  &.assistant {
    flex-direction: column;
  }
}
.bubble {
  background-color: #24263a;
  border-radius: $borderRadius;
  padding: 8px 10px;
  max-width: 100%;
  line-height: 1.5;

  &.welcome {
    color: $textColor;
  }
  &.error-bubble {
    color: #e85c5c;
    background-color: rgba(#e85c5c, .12);
  }
}
.recommends {
  display: flex;
  flex-wrap: wrap;
  margin-top: 8px;

  .recommend {
    font-size: 12px;
    background-color: #24263a;
    border-radius: $borderRadius;
    padding: 3px 6px;
    margin-right: 5px;
    margin-top: 5px;
    cursor: pointer;

    &:hover {
      color: $themeColor;
    }
  }
}
.outline-bubble, .template-bubble {
  width: 100%;

  pre {
    max-height: 260px;
    padding: 8px;
    margin-bottom: 10px;
    background-color: $lightGray;
    border-radius: $borderRadius;
    overflow: auto;
    white-space: pre-wrap;
  }
  .outline-view {
    max-height: 260px;
    padding: 8px;
    margin-bottom: 10px;
    background-color: $lightGray;
    border-radius: $borderRadius;
    overflow: auto;
  }
  .outline-done {
    color: #7a7b95;
    font-style: italic;
  }
  .btns {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 8px;

    .btn {
      width: 50%;
      margin: 0 4px;
    }
  }
}
.template-bubble {
  .templates {
    max-height: 320px;
    overflow: auto;
    display: flex;
    margin-bottom: 10px;
    padding-right: 5px;
    @include flex-grid-layout();

    .template {
      border: 2px solid $borderColor;
      border-radius: $borderRadius;
      @include flex-grid-layout-children(2, 49%);

      &.selected {
        border-color: $themeColor;
      }

      img {
        width: 100%;
        min-height: 90px;
      }
    }
  }
}
.quick-settings {
  flex-shrink: 0;
  padding: 8px 12px;
  border-top: 1px solid $borderColor;
  display: flex;
  align-items: center;
  gap: 10px;

  .config-item {
    display: flex;
    align-items: center;
    gap: 6px;

    .label {
      color: #9a9bb5;
      white-space: nowrap;
    }
  }
}
.chat-input {
  flex-shrink: 0;
  padding: 10px 12px;

  .count {
    font-size: 12px;
    color: #7a7b95;
    margin-right: 6px;
  }
  .submit {
    height: 22px;
    width: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: $themeColor;
    border-radius: $borderRadius;
    cursor: pointer;
    color: #fff;

    &:hover {
      background-color: $themeHoverColor;
    }
  }
}
</style>
