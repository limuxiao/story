import { useRoute } from "./router";
import Home from "./pages/Home";
import App from "./App";

// 默认页是首页；/project/<id> 打开对应工程。key 保证切换工程时重新加载。
export default function Root() {
  const route = useRoute();
  if (route.view === "editor") {
    return <App key={route.projectId} projectId={route.projectId} />;
  }
  return <Home />;
}
