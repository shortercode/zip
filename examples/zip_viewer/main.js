import { ZipArchive } from "../../dist/zip_default.js";

const { createElement, Fragment, Component } = React;

function files_from_data_transfer (data_transfer) {
    const files = [];
    if (data_transfer.items) {
        for (const item of data_transfer.items) {
            if (item.kind === 'file') {
                files.push(item.getAsFile());
            }
        }
    } else {
        for (const file of data_transfer.files) {
            files.push(file);
        }
    }
    return files;
}

class RootComponent extends Component {
    constructor (props) {
        super(props);
        this.state = { archive: null };
        this.on_archive_change = archive => this.setState({ archive });
    }

    render () {
        if (this.state.archive) {
            return createElement(ViewerComponent, { archive: this.state.archive });
        }
        else {
            return createElement(DropZoneComponent, { on_archive_change: this.on_archive_change });
        }
    }
}

class DropZoneComponent extends Component {
    constructor (props) {
        super(props);
        this.state = { is_drag_active: false, is_busy: false, error_message: "" };
    }
    on_drop (e) {
        e.preventDefault();
        const files = files_from_data_transfer(e.dataTransfer);

        if (files.length > 1) {
            this.setState({ error_message: "Please drop only 1 file" });
            return;
        }

        this.read_file(files[0]);
    }
    on_drag_over (e) {
        e.preventDefault();
        this.setState({ is_drag_active: true });
    }
    on_drag_leave (e) {
        this.setState({ is_drag_active: false });
    }
    async read_file (file) {
        this.setState({ is_busy: true, error_message: "", is_drag_active: false });
        try {
            const archive = await ZipArchive.from_blob(file);
            this.props.on_archive_change(archive);
        }
        catch (e) {
            this.setState({ error_message: "Unable to read the file, is it a Zip file?" });
        }
        finally {
            this.setState({ is_busy: false });
        }
    }
    render () {
        let text = "Drop a zip file here or click and select a file to begin";

        if (this.state.is_busy) {
            text = "Processing file...";
        }
        else if (this.state.is_drag_active) {
            text = "Drop file here...";
        }
        else if (this.state.error_message) {
            text = this.state.error_message;
        }

        return createElement(
            "label",
            { 
                className: "drop-zone",
                onDrop: e => this.on_drop(e),
                onDragover: e => this.on_drag_over(e),
                onDragleave: e => this.on_drag_leave(e) 
            },
            createElement(Fragment, {}, text),
            createElement(
                "input",
                {
                    type: "file",
                    onChange: e => this.read_file(e.files[0])
                }
            )
        );
    }
}

function ViewerComponent (props) {
    
}

ReactDOM.render(createElement(RootComponent), document.body);