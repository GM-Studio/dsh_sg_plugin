import { createApp } from 'vue';
import App from './App.vue';
import 'element-plus/dist/index.css';
import './style.css';
import { i18n } from './i18n';

createApp(App).use(i18n).mount('#app');
