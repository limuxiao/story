import { useRoute } from "./router";
import Home from "./pages/Home";
import App from "./App";
import CanvasEditor from "./pages/CanvasEditor";

// 默认页是首页；/project/<id> 是 DOM 时间轴编辑器，/canvas/<id> 是全 canvas 时间轴实验页。
// key 保证切换工程或切换实现时重新加载，避免两个编辑器共享同一份 store 状态。
export default function Root() {
  const route = useRoute();
  if (route.view === "editor") {
    return <App key={route.projectId} projectId={route.projectId} />;
  }
  if (route.view === "canvasEditor") {
    return <CanvasEditor key={route.projectId} projectId={route.projectId} />;
  }
  return <Home />;
}
