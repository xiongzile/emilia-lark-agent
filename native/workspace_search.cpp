#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <string_view>

namespace fs = std::filesystem;

constexpr std::uintmax_t kMaxFileBytes = 1024 * 1024;
constexpr std::size_t kMaxFiles = 30000;
constexpr std::size_t kMaxMatches = 80;

bool within(const fs::path& root, const fs::path& candidate) {
    auto left = root.begin();
    auto right = candidate.begin();
    for (; left != root.end(); ++left, ++right) {
        if (right == candidate.end() || *left != *right) return false;
    }
    return true;
}

bool excluded(const fs::path& path) {
    for (const auto& part : path) {
        const std::string name = part.string();
        if (name.empty() || name == "." || name == "..") continue;
        if (name[0] == '.' || name == "node_modules" || name == "build" ||
            name == "dist" || name == "logs" || name == "tmp" || name == "target") return true;
    }
    return false;
}

std::string lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

void searchFile(const fs::path& root, const fs::path& path, const std::string& query,
                bool ignoreCase, std::size_t& matches) {
    std::error_code error;
    const auto size = fs::file_size(path, error);
    if (error || size > kMaxFileBytes) return;

    std::ifstream input(path, std::ios::binary);
    if (!input) return;
    const std::string content{std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
    if (content.find('\0') != std::string::npos) return;

    const std::string needle = ignoreCase ? lower(query) : query;
    std::size_t start = 0;
    std::size_t lineNumber = 1;
    while (start < content.size() && matches < kMaxMatches) {
        const std::size_t end = content.find('\n', start);
        const std::size_t length = (end == std::string::npos ? content.size() : end) - start;
        const std::string line = content.substr(start, length);
        const std::size_t column = (ignoreCase ? lower(line) : line).find(needle);
        if (column != std::string::npos) {
            const std::size_t excerptStart = column > 80 ? column - 80 : 0;
            std::string excerpt = line.substr(excerptStart, 240);
            std::replace(excerpt.begin(), excerpt.end(), '\r', ' ');
            std::cout << fs::relative(path, root).generic_string() << ':' << lineNumber << ':'
                      << column + 1 << ": " << excerpt << '\n';
            ++matches;
        }
        if (end == std::string::npos) break;
        start = end + 1;
        ++lineNumber;
    }
}

int main(int argc, char* argv[]) {
    bool ignoreCase = false;
    int first = 1;
    if (argc > 1 && std::string_view(argv[1]) == "--ignore-case") {
        ignoreCase = true;
        ++first;
    }
    if (argc - first < 1 || argc - first > 2 || std::string_view(argv[first]).empty()) {
        std::cerr << "Usage: workspace-search [--ignore-case] <literal-query> [relative-path]\n";
        return 2;
    }

    try {
        const fs::path root = fs::canonical(fs::current_path());
        const fs::path requested = argc - first == 2 ? fs::path(argv[first + 1]) : fs::path(".");
        if (requested.is_absolute()) {
            std::cerr << "Path must be relative to the workspace\n";
            return 2;
        }
        fs::path current = root;
        for (const auto& part : requested) {
            if (part == "..") {
                std::cerr << "Parent traversal is not allowed\n";
                return 2;
            }
            current /= part;
            if (fs::is_symlink(fs::symlink_status(current))) {
                std::cerr << "Symlink paths are not searchable\n";
                return 2;
            }
        }
        const fs::path target = fs::canonical(root / requested);
        if (!within(root, target) || excluded(target.lexically_relative(root))) {
            std::cerr << "Path is outside searchable workspace\n";
            return 2;
        }

        std::size_t files = 0;
        std::size_t matches = 0;
        auto visit = [&](const fs::path& path) {
            if (++files > kMaxFiles) return false;
            searchFile(root, path, argv[first], ignoreCase, matches);
            return true;
        };

        if (fs::is_regular_file(target)) {
            if (!visit(target)) return 2;
        } else if (fs::is_directory(target)) {
            fs::recursive_directory_iterator it(target, fs::directory_options::skip_permission_denied);
            const fs::recursive_directory_iterator end;
            for (; it != end && matches < kMaxMatches; ++it) {
                const auto& entry = *it;
                if (entry.is_symlink()) continue;
                if (excluded(entry.path().filename())) {
                    if (entry.is_directory()) it.disable_recursion_pending();
                    continue;
                }
                if (entry.is_regular_file() && !visit(entry.path())) {
                    std::cerr << "Search stopped after " << kMaxFiles << " files; narrow the path\n";
                    return 2;
                }
            }
        } else {
            std::cerr << "Path is not a regular file or directory\n";
            return 2;
        }

        if (matches == 0) std::cout << "No matches.\n";
        else if (matches == kMaxMatches) std::cout << "Match limit reached; narrow the path.\n";
        return 0;
    } catch (const fs::filesystem_error& error) {
        std::cerr << "Search failed: " << error.code().message() << '\n';
        return 2;
    }
}
