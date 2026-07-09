<template>
  <div class="pptist-screen">
    <AudienceView v-if="isAudienceMode" />
    <BaseView :changeViewMode="changeViewMode" v-else-if="viewMode === 'base'" />
    <PresenterView :changeViewMode="changeViewMode" v-else-if="viewMode === 'presenter'" />
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { KEYS } from '@/configs/hotkey'
import useScreening from '@/hooks/useScreening'

import AudienceView from './AudienceView.vue'
import BaseView from './BaseView.vue'
import PresenterView from './PresenterView.vue'

const isAudienceMode = new URLSearchParams(window.location.search).get('mode') === 'audience'

const viewMode = ref<'base' | 'presenter'>('base')

const changeViewMode = (mode: 'base' | 'presenter') => {
  viewMode.value = mode
}

const { exitScreening: _exitScreening } = useScreening()

const syncChannel = !isAudienceMode ? new BroadcastChannel('pptist-audience-sync') : null

const exitScreening = () => {
  syncChannel?.postMessage({ type: 'EXIT' })
  _exitScreening()
}

// Hotkey to exit the show (ESC does not respond in audience view; the user closes the window directly)
const keydownListener = (e: KeyboardEvent) => {
  const key = e.key.toUpperCase()
  if (key === KEYS.ESC) exitScreening()
}

onMounted(() => {
  if (!isAudienceMode) document.addEventListener('keydown', keydownListener)
})
onUnmounted(() => {
  if (!isAudienceMode) document.removeEventListener('keydown', keydownListener)
  syncChannel?.close()
})
</script>

<style lang="scss" scoped>
.pptist-screen {
  width: 100%;
  height: 100%;
}
</style>