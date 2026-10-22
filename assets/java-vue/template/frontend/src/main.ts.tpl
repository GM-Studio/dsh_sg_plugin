import { createApp } from 'vue';
import App from './App.vue';
import 'element-plus/dist/index.css';
import './style.css';
import { i18n } from './i18n';
import { createAppRouter } from './router';

createApp(App).use(i18n).use(createAppRouter()).mount('#app');
