import { Button } from "@common/components/Button"
import { Plus } from "lucide-react"

export const AgentControls = () => {
    return (
        <div className="py-4 h-full flex flex-col bg-background">
            <div className="px-4">
                <Button>
                    <Plus />
                    New Agent
                </Button>
            </div>
        </div>
    )
}