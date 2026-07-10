<template>
  <div class="pptist-editor">
    <EditorHeader class="layout-header" />
    <div class="layout-content">
      <Thumbnails class="layout-content-left" />
      <div class="layout-content-center" :style="{ width: centerWidth }">
        <CanvasTool class="center-top" />
        <Canvas class="center-body" :style="{ height: `calc(100% - ${remarkHeight + 40}px)` }" />
        <Remark
          class="center-bottom"
          v-model:height="remarkHeight"
          :style="{ height: `${remarkHeight}px` }"
        />
      </div>
      <Toolbar class="layout-content-right" />
      <AIAssistantPanel v-if="showAIPPTDialog" class="layout-content-ai-panel" />
    </div>
  </div>

  <SelectPanel v-if="showSelectPanel" />
  <SearchPanel v-if="showSearchPanel" />
  <NotesPanel v-if="showNotesPanel" />
  <MarkupPanel v-if="showMarkupPanel" />
  <SymbolPanel v-if="showSymbolPanel" />
  <ImageLibPanel v-if="showImageLibPanel" />
  <ChartDataEditorDialog />
  <LatexEditorDialog />

  <Modal
    :visible="!!dialogForExport"
    :width="680"
    @closed="closeExportDialog()"
  >
    <ExportDialog />
  </Modal>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import useGlobalHotkey from '@/hooks/useGlobalHotkey'
import usePasteEvent from '@/hooks/usePasteEvent'

import EditorHeader from './EditorHeader/index.vue'
import Canvas from './Canvas/index.vue'
import CanvasTool from './CanvasTool/index.vue'
import Thumbnails from './Thumbnails/index.vue'
import Toolbar from './Toolbar/index.vue'
import Remark from './Remark/index.vue'
import ChartDataEditorDialog from './ChartDataEditorDialog.vue'
import LatexEditorDialog from './LatexEditorDialog.vue'
import ExportDialog from './ExportDialog/index.vue'
import SelectPanel from './SelectPanel.vue'
import SearchPanel from './SearchPanel.vue'
import NotesPanel from './NotesPanel.vue'
import SymbolPanel from './SymbolPanel.vue'
import MarkupPanel from './MarkupPanel.vue'
import ImageLibPanel from './ImageLibPanel.vue'
import AIAssistantPanel from './AIAssistantPanel/index.vue'
import Modal from '@/components/Modal.vue'

const mainStore = useMainStore()
const {
  dialogForExport,
  showSelectPanel,
  showSearchPanel,
  showNotesPanel,
  showSymbolPanel,
  showMarkupPanel,
  showImageLibPanel,
  showAIPPTDialog,
} = storeToRefs(mainStore)

const closeExportDialog = () => mainStore.setDialogForExport('')

const remarkHeight = ref(40)

// AI panel adds a 4th flex column (320px + 1 extra 8px gap) when open
const centerWidth = computed(() => {
  return showAIPPTDialog.value
    ? 'calc(100% - 160px - 260px - 320px - 24px)'
    : 'calc(100% - 160px - 260px - 16px)'
})

useGlobalHotkey()
usePasteEvent()
</script>

<style lang="scss" scoped>
.pptist-editor {
  height: 100%;
  background-color: $pageBackground;
}
.layout-header {
  height: 40px;
}
.layout-content {
  height: calc(100% - 40px);
  display: flex;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
}
.layout-content-left {
  width: 160px;
  height: 100%;
  flex-shrink: 0;
  border-radius: 12px;
  box-shadow: $boxShadow;
  background-color: $lightGray;
  overflow: hidden;
}
.layout-content-center {
  flex-shrink: 0;

  .center-top {
    height: 40px;
    border-radius: 12px 12px 0 0;
    background-color: $lightGray;
    overflow: hidden;
  }
}
.layout-content-right {
  width: 260px;
  height: 100%;
  flex-shrink: 0;
  border-radius: 12px;
  box-shadow: $boxShadow;
  background-color: $lightGray;
  overflow: hidden;
}
.layout-content-ai-panel {
  width: 320px;
  height: 100%;
  flex-shrink: 0;
  border-radius: 12px;
  box-shadow: $boxShadow;
  background-color: $lightGray;
  overflow: hidden;
}
</style>
